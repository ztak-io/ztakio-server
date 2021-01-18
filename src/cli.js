const url = require('url')
const yargs = require('yargs')
const ztak = require('ztakio-core')
const ztakioDb = require('ztakio-db')
const bitcoin = require('bitcoinjs-lib')
const bitcoinMessage = require('bitcoinjs-message')
const fs = require('fs')
const fsPromises = require('fs').promises
const mustache = require('mustache')
const path = require('path')
const rpc = require('json-rpc2')
const { promisify } = require('util')
const { crypto } = require('bitcoinjs-lib')
const { isAddress } = require('./util')
const ztaklib = require('ztakio-lib')
const ora = require('ora')

const config = require('./config')

const tryFiles = async (list) => {
  for (let i=0; i < list.length; i++) {
    const {file, cb} = list[i]
    let data
    try {
      data = await fsPromises.readFile(file, 'utf8')
    } catch (e) {
      data = null
    }

    if (data) {
      return await cb(data)
    }
  }

  return null
}

const connect = () => {
  const [user, pass] = (config.webbasicauth || '').split(':')
  const opts = {}
  const serverUrl = url.parse(config.connect)
  let connectHost
  if (serverUrl.hostname) {
    connectHost = serverUrl.hostname
  } else {
    connectHost = serverUrl.pathname
  }
  const client = rpc.Client.$create(config.webport, connectHost, user, pass)
  if (serverUrl.protocol === 'https:') {
    opts.https = true
  }
  if (connectHost != 'localhost' && serverUrl.path) {
    opts.path = serverUrl.path
  }

  return {client, opts}
}

const readStdin = () => new Promise((resolve, reject) => {
  fs.read(0, (err, bytesRead, buffer) => {
    if (err) {
      reject(err)
    } else {
      resolve(buffer.toString('utf8'))
    }
  })
})

const commands = {
  'createwallet': () => {
    const ecpair = bitcoin.ECPair.makeRandom()
    let network = ztak.networks.mainnet

    if (config.testnet) {
      network = ztak.networks.testnet
    }

    const { address } = bitcoin.payments.p2pkh({ pubkey: ecpair.publicKey, network: network })

    console.log('Address:', address)
    console.log('Wif:', ecpair.toWIF())
  },

  'compile': async (file, options) => {
    let code
    if (file === '-') {
      code = await readStdin()
    } else {
      code = fs.readFileSync(path.resolve(file), 'utf8')
    }
    let byteCode = ztak.asm.compile(code)

    if (options.wif) {
      const ecpair = bitcoin.ECPair.fromWIF(options.wif)
      console.log(ztak.buildEnvelope(ecpair, byteCode).toString('hex'))
    } else {
      console.log(byteCode.toString('hex'))
    }
  },

  'sign': async (file, options) => {
    let hex
    if (file === '-') {
      hex = await readStdin()
    } else {
      try {
        hex = fs.readFileSync(path.resolve(file), 'utf8')
      } catch(e) {
        hex = file
      }
    }
    let byteCode = Buffer.from(hex, 'hex')

    if (options.wif) {
      const ecpair = bitcoin.ECPair.fromWIF(options.wif)
      console.log(ztak.buildEnvelope(ecpair, byteCode).toString('hex'))
    } else {
      console.log(byteCode.toString('hex'))
    }
  },

  'exec': async (hex) => {
    let { core } = require('./index')

    if (!hex || typeof(hex) === 'object') {
      hex = await readStdin()
    }

    const msg = ztak.openEnvelope(Buffer.from(hex, 'hex'))

    const prog = Buffer.from(msg.data, 'hex')
    const executor = core()(msg.from, msg.txid)
    console.log(await executor(prog))
  },

  'dumpdb': async (opts) => {
    const leveldown = require('leveldown')
    const db = ztakioDb(leveldown(opts.datadir))
    let ldb = db._raw()

    let ret = {}
    ldb.createReadStream().on('data', (data) => {
      ret[data.key.toString('utf8')] = JSON.parse(data.value)
    }).on('error', (err) => {
      console.log('Error while dumping:', err)
    }).on('end', () => {
      console.log(ret)
    })
  },

  /*'template': async (contract, ...args) => {
    let bname = path.basename(contract)
    let fpath = process.cwd() + '/contracts/' + bname + '.asm'
    try {
      let template = await fsPromises.readFile(fpath, 'utf8')
      console.log(mustache.render(template, args[0]))
    } catch(e) {
      console.log(e)
      throw new Error(`Contract ${bname} isn't loaded in this instance (check ${fpath} exists`)
    }
  },*/

  'template': async (contract, ...args) => {
    contract = path.basename(contract)
    const templatePath = './contracts/'
    if (typeof(contract) !== 'string') {
      let help = "Usage: template <template_name> [array of -- parameters]"
      let scripts = uniqueFileNames(await dirContents(templatePath))
      help += "\nAvailable Scripts:\n  " + scripts.join('\n  ')
      return help
    }

    let bname = path.basename(contract)
    let fpath = templatePath + bname

    let result = await tryFiles([
      {file: fpath + '.til', cb: (code) => {
          let rend = mustache.render(code, args[0])
          let comp = ztak.tilc(rend)
          return comp
        }
      },
      {file: fpath + '.asm', cb: (code) => '#asm\n' + mustache.render(code, args)},
    ])

    if (result) {
      console.log(result)
    } else {
      console.log(`Contract ${bname} isn't loaded in this instance`)
    }
  },

  'rpc': async (command, ...args) => {
    const {client, opts} = connect()

    let params = args.slice(0, -1)

    for (let i=0; i < params.length; i++) {
      if (params[i] === '-') {
        // Replace parameter with stdin
        params[i] = await readStdin()
      }
    }

    client.call(command, params, opts, (err, result) => {
      if (err) {
        console.error(err)
      } else {
        console.log(result)
      }
    })
  },

  'watch': async (regex) => {
    /*const [user, pass] = (config.webbasicauth || '').split(':')
    const client = rpc.Client.$create(config.webport, config.connect, user, pass)*/
    const {client, opts} = connect()
    if (opts.https) {
      client.host = 'wss://' + client.host + ':443' + opts.path
      console.log(client.host)
    }
    client.connectWebsocket(async (err, conn) => {
      if (err) {
        console.log(err)
        process.exit(1)
        return
      } else if (!conn) {
        console.log('Server unavailable')
        return
      }

      conn.callAsync = promisify(conn.call)

      client.expose('event', async ([key]) => {
        try {
          let value = await conn.callAsync('core.get', [key])
          console.log('Event', key, value)
        } catch(e) {
          console.log(`Error while getting value for key ${key}:`, e)
        }
      })

      try {
        await conn.callAsync('core.subscribe', [regex], opts)
        console.log('Subscribed to events on:', regex)
      } catch(e) {
        console.log('Error while subscribing:', e)
        process.exit(1)
      }
    })
  },

  'mine': async (options) => {
    if (options.wif) {
      const ecpair = bitcoin.ECPair.fromWIF(options.wif)
      let network = ztak.networks.mainnet

      if (config.testnet) {
        network = ztak.networks.testnet
      }

      const { address } = bitcoin.payments.p2pkh({ pubkey: ecpair.publicKey, network: network })

      const [user, pass] = (config.webbasicauth || '').split(':')
      const client = rpc.Client.$create(config.webport, config.connect, user, pass)
      client.callAsync = promisify(client.call)

      let mempool = await client.callAsync('core.mempool', [])
      let poaSignedTxs = {}

      for (let i=0; i < mempool.length; i++) {
        let txid = mempool[i]
        let txFeds = await client.callAsync('core.get', [`/_/tx.${txid}.feds`])

        for (let fed in txFeds) {
          let fedData = await client.callAsync('core.get', [`${fed}.meta`])
          if (fedData.FedType === 'poa') {
            // This federation uses proof of authority
            for (let poaIdx=0; poaIdx < 10000; poaIdx++) {
              let key = `${fed}/_poa_${poaIdx}`
              let poaData = await client.callAsync('core.get', [key])

              if (poaData !== null) {
                if (poaData === address) {
                  if (!(fed in poaSignedTxs)) {
                    poaSignedTxs[fed] = {}
                  }
                  // We can sign this!
                  //let signature = ecpair.sign(Buffer.from(txid, 'hex'))
                  let signature = bitcoinMessage.sign(txid, ecpair.privateKey, ecpair.compressed)
                  poaSignedTxs[fed][txid] = [poaIdx, signature.toString('base64')]
                }
              } else {
                // On the first "null" we bailout
                break
              }
            }
          }
        }

        if (Object.keys(poaSignedTxs).length > 0) {
          let opcodes = []
          for (let fed in poaSignedTxs) {
            opcodes.push(`REQUIRE ${fed}`)
            let txs = Object.entries(poaSignedTxs[fed]).sort((a, b) => a[0].localeCompare(b[0]))
            for (let txIdx=0; i < txs.length; i++) {
              let tx = txs[txIdx]
              opcodes.push(`PUSHS "${tx[0]}"`)
              opcodes.push(`PUSHI ${tx[1][0]}`)
              opcodes.push(`PUSHS "${tx[1][1]}"`)
              opcodes.push(`ECALL ${fed}:federation`)
            }
            opcodes.push('PUSHI 1')
            opcodes.push('VERIFY "tx-error-while-verify"')
            opcodes.push(`END`)
          }
          let code = opcodes.join('\n')
          let byteCode = ztak.asm.compile(code)
          console.log(ztak.buildEnvelope(ecpair, byteCode).toString('hex'))
          //console.log(code)
        }
      }
    } else {
      console.log('Must pass a --wif parameter for the signing key')
    }
  },

  'changeowner': async (namespace, newOwner) => {
    const leveldown = require('leveldown')
    const db = ztakioDb(leveldown(config.datadir))
    let ldb = db._raw()

    let meta = await ldb.get(namespace + '.meta')
    meta = JSON.parse(meta.toString('utf8'))
    console.log('PREV', meta)
    meta._v.Author = newOwner
    meta._v.Address = newOwner
    await ldb.put(namespace + '.meta', JSON.stringify(meta))
    console.log('NEW', meta)
  },

  'abihash': async (hex) => {
    if (!hex || typeof(hex) === 'object') {
      hex = await readStdin()
    }

    const decoded = ztak.decode(Buffer.from(hex, 'hex'))

    if (decoded.entrypoints) {
      let hash = crypto.sha256(decoded.entrypoints.sort().join(','))
      console.log(hash.toString('hex'))
    } else {
      console.log('Not a contract deployment')
    }
  },

  'listContracts': async (path, abi) => {

  },

  'rebuildindex': async (opts) => {
    const spinner = ora('Rebuilding index').start()

    const leveldown = require('leveldown')
    const db = ztakioDb(leveldown(opts.datadir || './data'))

    let iter = db.iterator({ gt: '/_/tx.' })

    const ts = Date.now()
    const index = {}
    const addressTx = (addr, tx) => {
      if (!(addr in index)) {
        index[addr] = { txs: {} }
      }
      index[addr].txs[tx] = ts
    }
    const addressKey = (addr, key) => {
      if (!(addr in index)) {
        index[addr] = { txs: {} }
      }
      index[addr][key] = ''
    }

    let scanning = true
    let num = 0
    spinner.color = 'yellow'
    while (scanning) {
      let {value: result, done} = await iter.next()
      if (done) {
        scanning = false
      }

      if (result) {
        let { key, value } = result
        let txid = key.split('.').pop()
        if (key.startsWith('/_/tx.') && Buffer.isBuffer(value)) {
          try {
            let { from, calls } = ztaklib.decodeCall(value)

            addressTx(from, txid)

            for (let i=0; i < calls.length; i++) {
              let call = calls[i]
              for (let path in call) {
                let params = call[path]
                for (let j=0; j < params.length; j++) {
                  if (isAddress(params[j])) {
                    addressTx(params[j], txid)
                  }
                }
              }
            }
          } catch(e) {
            // ignore
            console.log(key, e.message)
          }
        }
        num++
        spinner.text = 'Scanned ' + num + ' txs'
      }
    }

    spinner.color = 'blue'
    console.log(`\nTX Index built, ${Object.keys(index).length} total addresses found`)

    iter = db.iterator({ gt: '/hazama/' })
    scanning = true
    num = 0
    while (scanning) {
      let {value: result, done} = await iter.next()
      if (result) {
        let { key, value } = result
        let parts = key.split('/')
        for (let i=0; i < parts.length; i++) {
          if (isAddress(parts[i])) {
            addressKey(parts[i], key)
          }
        }

        if (typeof(value) === 'string' && isAddress(value)) {
          addressKey(value, key)
        }
      }

      if (done) {
        scanning = false
      }

      num++
      spinner.text = 'Scanned ' + num + ' keys'
    }

    console.log(`\nKey Index built, ${Object.keys(index).length} total addresses found`)
    num = 0
    spinner.color = 'green'
    for (let addr in index) {
      let prev = await db.get(`/_/addr.${addr}`)
      if (prev) {
        let { txs: prevTxs, ...prevKeys } = prev
        let { txs, ...keys } = index[addr]

        if (prevTxs) {
          txs = { ...txs, ...prevTxs}
        }

        keys = { ...keys, ...prevKeys }

        index[addr] = { txs, ...keys }
        num++
      }
      spinner.text = 'Rebuilt ' + num + ' indexes'
    }

    console.log(`\nMerged ${num} existing keys`)

    num = 0
    spinner.color = 'white'
    for (let addr in index) {
      await db.put(`/_/addr.${addr}`, index[addr])
      num++
      spinner.text = 'Saved ' + num + ' indexes'
    }

    console.log(`\nSaved ${num} address indexes`)

    process.exit(0)
  }
}

if (config._.length > 0 && config._[0] in commands) {
  let { _: [command, ...params], ...rest } = config
  commands[command](...params, rest)
} else {
  console.log('ztak-cli: Command line interface to Ztakio-server\nInvalid command. Available commands:\n'+ Object.keys(commands).map(x => ' * ' + x).join('\n'))
}
