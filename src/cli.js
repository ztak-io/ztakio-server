const yargs = require('yargs')
const ztak = require('ztakio-core')
const ztakioDb = require('ztakio-db')
const bitcoin = require('bitcoinjs-lib')
const fs = require('fs')
const fsPromises = require('fs').promises
const mustache = require('mustache')
const path = require('path')
const rpc = require('json-rpc2')

const config = require('./config')

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
      hex = fs.readFileSync(path.resolve(file), 'utf8')
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
    let core = require('./index')

    if (!hex || typeof(hex) === 'object') {
      hex = await readStdin()
    }

    const msg = ztak.openEnvelope(Buffer.from(hex, 'hex'))

    const prog = Buffer.from(msg.data, 'hex')
    const executor = core(msg.from)
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

  'template': async (contract, ...args) => {
    let bname = path.basename(contract)
    let fpath = process.cwd() + '/contracts/' + bname + '.asm'
    try {
      let template = await fsPromises.readFile(fpath, 'utf8')
      console.log(mustache.render(template, args[0]))
    } catch(e) {
      console.log(e)
      throw new Error(`Contract ${bname} isn't loaded in this instance (check ${fpath} exists`)
    }
  },

  'rpc': async (command, ...args) => {
    const [user, pass] = (config.webbasicauth || '').split(':')
    const client = rpc.Client.$create(config.webport, config.connect, user, pass)

    let params = args.slice(0, -1)

    for (let i=0; i < params.length; i++) {
      if (params[i] === '-') {
        // Replace parameter with stdin
        params[i] = await readStdin()
      }
    }

    client.call(command, params, (err, result) => {
      if (err) {
        console.error(err)
      } else {
        console.log(result)
      }
    })
  },

  'watch': async (regex) => {
    const [user, pass] = (config.webbasicauth || '').split(':')
    const client = rpc.Client.$create(config.webport, config.connect, user, pass)

    client.connectWebsocket((err, conn) => {
      if (err) {
        console.log(err)
        return
      }

      client.expose('event', (params) => {
        console.log('Server event:', params)
      })

      conn.call('core.subscribe', [regex], (err) => {
        if (err) {
          console.error(err)
        } else {
          console.log('Subscribed to events on:', regex)
        }
      })
    })
  }
}

if (config._.length > 0 && config._[0] in commands) {
  let { _: [command, ...params], ...rest } = config
  commands[command](...params, rest)
} else {
  console.log('ztak-cli: Command line interface to Ztakio-server\nInvalid command. Available commands:\n'+ Object.keys(commands).map(x => ' * ' + x).join('\n'))
}
