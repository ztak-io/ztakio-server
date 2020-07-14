const {argv} = require('yargs')
const ztak = require('ztakio-core')
const ztakioDb = require('ztakio-db')
const bitcoin = require('bitcoinjs-lib')
const fs = require('fs')
const path = require('path')

const commands = {
  'createwallet': () => {
    const ecpair = bitcoin.ECPair.makeRandom()
    let network = ztak.networks.mainnet

    if (argv.testnet) {
      network = ztak.networks.testnet
    }

    const { address } = bitcoin.payments.p2pkh({ pubkey: ecpair.publicKey, network: network })

    console.log('Address:', address)
    console.log('Wif:', ecpair.toWIF())
  },

  'compile': (file, options) => {
    let code = fs.readFileSync(path.resolve(file), 'utf8')
    let byteCode = ztak.asm.compile(code)

    if (options.wif) {
      const ecpair = bitcoin.ECPair.fromWIF(options.wif)
      console.log(ztak.buildEnvelope(ecpair, byteCode).toString('hex'))
    } else {
      console.log(byteCode.toString('hex'))
    }
  },

  'exec': async (hex) => {
    let core = require('./index')

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
      ret[data.key.toString('utf8')] = data.value
    }).on('error', (err) => {
      console.log('Error while dumping:', err)
    }).on('end', () => {
      console.log(ret)
    })
  }
}

if (argv._.length > 0 && argv._[0] in commands) {
  let { _: [command, ...params], ...rest } = argv
  commands[command](...params, rest)
} else {
  console.log('ztak-cli\nInvalid command. Available commands:\n', Object.keys(commands).map(x => ' * ' + x).join('\n'))
}
