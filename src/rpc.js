const fs = require('fs').promises
const path = require('path')
const mustache = require('mustache')
const ztak = require('ztakio-core')
const asm = require('ztakio-core')
const ztakiocorePkg = require('ztakio-core/package.json')
const ztakiodbPkg = require('ztakio-db/package.json')
const ztakioserverPkg = require('../package.json')

const startTime = BigInt(Date.now())

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

module.exports = (cfg, core, network, db) => {
  return {
    'info': async () => {
      let ob = {
        'ztakio-core.version': ztakiocorePkg.version,
        'ztakio-db.version': ztakiodbPkg.version,
        'ztakio-server.version': ztakioserverPkg.version,
        'defaultAddressVersion': network.pubKeyHash,
        'runningSeconds': ((BigInt(Date.now()) - startTime) / 1000n).toString()
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
      return ret
    },

    'tx': async (envelope) => {
      const txBuffer = Buffer.from(envelope, 'hex')
      const msg = ztak.openEnvelope(txBuffer)

      let existing = await db.get(`/_/tx.${msg.txid}`)
      if (existing) {
        throw new Error('tx-exists')
      }

      db.setCurrentTxid(msg.txid)
      const prog = Buffer.from(msg.data, 'hex')
      const executor = core(msg.from)
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
        throw new Error('invalid-tx:' + res.split(' ').pop())
      }
    },

    'mempool': async () => {
      return await db.get('/_/mempool')
    },

    'template': async (contract, parameters) => {
      if (typeof(parameters) === 'string') {
        try {
          parameters = JSON.parse(parameters)
        } catch(e) {
          return "Invalid JSON data"
        }
      }
      let bname = path.basename(contract)
      let fpath = './contracts/' + bname

      let result = tryFiles([
        {file: fpath + '.til', cb: (code) => ztak.tilc(mustache.render(code, parameters))},
        {file: fpath + '.asm', cb: (code) => mustache.render(code, parameters)},
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
    }
  }
}
