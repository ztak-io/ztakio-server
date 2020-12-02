const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const mustache = require('mustache')
const ztak = require('ztakio-core')
const ztakiocorePkg = require('ztakio-core/package.json')
const ztakiodbPkg = require('ztakio-db/package.json')
const ztakioserverPkg = require('../package.json')
const JSBI = require('jsbi')

const MAX_ITER_FETCH_AMOUNT = 10

const startTime = BigInt(Date.now())
let processingBlock = false

const tryFiles = async (list) => {
  for (let i=0; i < list.length; i++) {
    const {file, cb} = list[i]
    let data
    try {
      data = await fs.readFile(file, 'utf8')
    } catch (e) {
      data = null
    }

    if (data) {
      return await cb(data)
    }
  }

  return null
}

async function dirContents(path) {
  const dir = await fs.opendir(path)
  let res = []
  for await (const dirent of dir) {
    res.push(dirent.name)
  }
  return res
}

function uniqueFileNames(arr) {
  let ob = {}

  if (arr) {
    arr.forEach(x => {
      ob[path.parse(x).name] = true
    })
  }

  return Object.keys(ob)
}

const iteratorId = () => new Promise((resolve, reject) => {
  crypto.randomBytes(16, (err, buf) => {
    if (err) {
      reject(err)
    } else {
      resolve(buf.toString('hex'))
    }
  })
})

// TODO: Close the iterators here after timeout
const currentIterators = {}
let currentVerificationCallbackWatchers = []

ztak.asm.registerVerificationCallback((msg) => {
  currentVerificationCallbackWatchers.forEach(notif => {
    notif(msg)
  })
})

module.exports = (cfg, core, network, db) => {
  return {
    'info': async () => {
      let ob = {
        'ztakio-core.version': ztakiocorePkg.version,
        'ztakio-db.version': ztakiodbPkg.version,
        'ztakio-server.version': ztakioserverPkg.version,
        'defaultAddressVersion': network.pubKeyHash,
        'runningSeconds': ((BigInt(Date.now()) - startTime) / 1000n).toString(),
        'network': ztak.networks.mainnet
      }

      if (db.stats) {
        ob.dbStats = db.stats
      }

      return ob
    },

    'get': async (key, encoding) => {
      if (!key) {
        throw new Error('must specify a key path')
      }
      if (!key.startsWith('/')) {
        throw new Error(`all keys must start with a /`)
      }

      if ('forceroot') {
        if (!(key.startsWith(cfg.forceroot) || key.startsWith('/_/'))) { // /_/ is the reserved public namespace
          throw new Error(`this server only handles keys under the ${cfg.forceroot} branch`)
        }
      }

      let ret = await db.get(key)
      if (encoding && typeof(encoding) === 'string') {
        console.log('Getting with encoding', encoding)
        ret = ret.toString(encoding)
      } else if (Buffer.isBuffer(ret)) {
        ret = ret.toString('hex')
      }
      if (typeof(ret) === 'bigint') {
        ret = ret.toString()
      }
      let isObject = typeof(ret) === 'object' && ret !== null
      if (isObject && 'sign' in ret) {
        ret = JSBI.toNumber(ret)
      } else if (isObject) {
        for (let x in ret) {
          let item = ret[x]
          if (typeof(item) === 'object' && ret !== null && 'sign' in item) {
            ret[x] = JSBI.toNumber(item)
          }
        }
      }
      return ret
    },

    'tx': async (envelope) => {
      if (typeof(envelope) !== 'string') {
        return "Usage: tx <hex_signed_tx>"
      }
      const txBuffer = Buffer.from(envelope, 'hex')
      const msg = ztak.openEnvelope(txBuffer)

      let existing = await db.get(`/_/tx.${msg.txid}`)
      if (existing) {
        throw new Error('tx-exists')
      }

      db.setCurrentTxid(msg.txid)
      const prog = Buffer.from(msg.data, 'hex')
      const executor = core(msg.from, msg.txid)
      let res = await executor(prog, cfg.requireFederation)

      if (res === true || typeof(res) === 'object') {
        let canCommit = typeof(res) !== 'object'

        if (typeof(res) === 'object') {
          let feds = {}
          for (let fid in res) {
            let spl = fid.split('/')

            for (let i=2; i <= spl.length; i++) {
              let fedname = spl.slice(0, i).join('/')
              let fedEntries = await db.get(`${fedname}.entrypoints`)

              if (fedEntries && 'federation' in fedEntries) {
                feds[fedname] = Buffer.from('')
              }
            }
          }

          if (Object.keys(feds).length > 0) {
            // Only commit transactions that have federation
            canCommit = true
            await db.put(`/_/tx.${msg.txid}.feds`, feds)
          }
        }

        if (canCommit) {
          await db.put(`/_/tx.${msg.txid}`, txBuffer)
          if (cfg.requireFederation) {
            let mempool = await db.get('/_/mempool')
            if (!mempool) {
              mempool = []
            }
            mempool.push(msg.txid)
            await db.put('/_/mempool', mempool)
          }
          return msg.txid
        } else {
          if (cfg.requireFederation) {
            throw new Error('invalid-tx:requires-federation')
          } else {
            throw new Error('invalid-tx')
          }
        }
      } else {
        throw new Error('invalid-tx:' + res.split(' ').map(x => x.toLowerCase()).join('-'))
      }
    },

    'block': async (envelope) => {
      if (typeof(envelope) !== 'string') {
        return "Usage: block <hex_block>"
      }

      if (!cfg.requireFederation) {
        throw new Error('no-federation-config')
      }
      const blockBuffer = Buffer.from(envelope, 'hex')
      const msg = ztak.openEnvelope(blockBuffer)

      let existing = await db.get(`/_/block.${msg.txid}`)
      if (existing) {
        throw new Error('block-exists')
      }

      if (processingBlock) {
        throw new Error('another-block-processing')
      }

      processingBlock = true
      try {
        db.setCurrentTxid(msg.txid)
        const prog = Buffer.from(msg.data, 'hex')
        const executor = core(msg.from, msg.txid)
        let res = await executor(prog, cfg.requireFederation)

        if (typeof(res) === 'object') {
          let canCommit = false

          if (res.commitState) {
            const testFedRegex = /\/_\/tx\..{64}\.feds/
            let keysModified = Object.entries(res.commitState)
            let amountReservedTxKeys = keysModified.filter(x => testFedRegex.test(x))

            if (keysModified.length === amountReservedTxKeys.length) {
              canCommit = true
            }
          }

          if (canCommit) {
            await db.commit(res.commitState)
            await db.put(`/_/block.${msg.txid}`, blockBuffer)

            const extractTxIdRegex = /\/_\/tx\.(.{64})\.feds/
            const removeFromMempool = {}

            for (let key in res.commitState) {
              let feds = await db.get(key)
              if (feds) {
                let canExec = true
                for (let fedId in feds) {
                  canExec = canExec && feds[fedId].length > 0
                }

                if (canExec) {
                  let matches = extractTxIdRegex.exec(key)
                  if (matches) {
                    const txId = matches.pop()
                    let tx = await db.get(`/_/tx.${txId}`)

                    if (tx) {
                      try {
                        console.log(`Commiting TX ${txId} from mempool`)
                        db.setCurrentTxid(txId)
                        const txmsg = ztak.openEnvelope(tx)
                        const txExecutor = core(txmsg.from, txId)
                        await txExecutor(Buffer.from(txmsg.data, 'hex'))
                        //mempool = mempool.filter(x => x !== txId)
                        removeFromMempool[txId] = true
                      } catch(e) {
                        // TODO Tx got invalidated between transmission and mining
                        console.log(e)
                        console.log(`TX ${txId} got invalidated before mining`)
                      }
                    }
                  }
                } else {
                  console.log(`TX ${txKey} waiting for more federations to mine it`)
                }
              } else {
                console.log(`TX ${txKey} mined in block but didnt require federation`)
              }
            }
            if (Object.keys(removeFromMempool).length > 0) {
              let mempool = await db.get('/_/mempool')
              await db.put('/_/mempool', mempool.filter(x => !(x in removeFromMempool)))
            }

            return msg.txid
          } else {
            throw new Error('invalid-block')
          }
        } else {
          throw new Error('invalid-block:' + res.split(' ').map(x => x.toLowerCase()).join('-'))
        }
      } finally {
        processingBlock = false
      }
    },

    'purgemempool': async () => {
      let mempool = await db.get('/_/mempool')
      let removes = {}

      for (let i=0; i < mempool.length; i++) {
        let txid = mempool[i]
        let tx = await db.get(`/_/tx.${txid}`)

        if (!tx) {
          removes[txid] = true
        }
      }

      if (Object.keys(removes).length > 0) {
        let mempool = await db.get('/_/mempool')
        await db.put('/_/mempool', mempool.filter(x => !(x in removes)))
      }

      return Object.keys(removes)
    },

    'mempool': async () => {
      return await db.get('/_/mempool')
    },

    'template': async (contract, parameters) => {
      const templatePath = './contracts/'
      if (typeof(contract) !== 'string') {
        let help = "Usage: template <template_name> <json_parameters_dict>"
        let scripts = uniqueFileNames(await dirContents(templatePath))
        help += "\nAvailable Scripts:\n  " + scripts.join('\n  ')
        return help
      }

      if (typeof(parameters) === 'string') {
        try {
          parameters = JSON.parse(parameters)
        } catch(e) {
          return "Invalid JSON data"
        }
      }
      let bname = path.basename(contract)
      let fpath = templatePath + bname

      let result = tryFiles([
        {file: fpath + '.til', cb: (code) => {
            let rend = mustache.render(code, parameters)
            let comp = ztak.tilc(rend)
            return comp
          }
        },
        {file: fpath + '.asm', cb: (code) => '#asm\n' + mustache.render(code, parameters)},
      ])

      if (result) {
        return result
      } else {
        throw new Error(`Contract ${bname} isn't loaded in this instance`)
      }
    },

    'subscribe': async (regex, opts) => {
      if (!db.registerWatcher) {
        throw new Error('DB Subscription not enabled on this server')
      }
      console.log('Registering sub:', regex)
      const notifier = (k, v) => {
        opts.call('event', k)
      }

      opts.stream(() => {
        console.log('Sub', regex, 'closed')
        db.unregisterWatcher(regex, notifier)
      })

      db.registerWatcher(regex, notifier)
    },

    'verifyevents': async (opts) => {
      const notifier = (v) => {
        opts.call('verifyevent', v)
      }

      opts.stream(() => {
        console.log('Sub for verify events closed')
        currentVerificationCallbackWatchers =
          currentVerificationCallbackWatchers.filter(x => x !== notifier)
      })

      //db.registerWatcher(regex, notifier)
      console.log('Client registering for verify events')
      currentVerificationCallbackWatchers.push(notifier)
    },

    'inititerator': async (options) => {
      let matcher
      if ('match' in options) {
        matcher = new RegExp(options.match)
        delete options.match
      }
      let iter = db.iterator(options)
      let id = await iteratorId()
      currentIterators[id] = { iter, ts: Date.now(), matcher }

      return id
    },

    'fetchiterator': async (id, amount) => {
      if (!(id in currentIterators)) {
        return null
      }

      if (amount > MAX_ITER_FETCH_AMOUNT) {
        amount = MAX_ITER_FETCH_AMOUNT
      }

      let res = []
      let hadValues = false
      let iterMeta = currentIterators[id]
      for (let i=0; i < amount; i++) {
        try {
          let {value, done} = await iterMeta.iter.next()
          if (done) {
            delete currentIterators[id]
            break
          } else if (value) {
            hadValues = true
            if (!iterMeta.matcher || iterMeta.matcher.test(value.key)) {
              res.push({key: value.key, value: value.value})
            }
          }
        } catch(e) {
          throw e
          delete currentIterators[id]
        }
      }

      return { res, hadValues }
    }
  }
}
