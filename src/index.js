const {argv} = require('yargs')
const leveldown = require('leveldown')
const rpc = require('json-rpc2')

const ztakioDb = require('ztakio-db')
const ztakioCore = require('ztakio-core')

const decorate = require('./decorator')

if (argv.conf) {
  const fs = require('fs')
  const ncfg = JSON.parse(fs.readFileSync(argv.conf, 'utf8'))

  for (x in ncfg) {
    if (!(x in argv)) {
      argv[x] = ncfg
    }
  }
}

const db = require('./dbstats')(ztakioDb(leveldown(argv.datadir)))
const network = ztakioCore.networks[argv.network || 'mainnet']

function core() {
  let ut = ztakioCore.utils(network)

  const executor = (callerAddress) => {
    const context = ztakioCore.asm.createContext(ut, db, callerAddress)
    return async (byteCode) => {
      try {
        context.loadProgram(byteCode)
        await ztakioCore.asm.execute(context)
        return true
      } catch (e) {
        console.log(e)
        return e.message
      }
    }
  }

  return executor
}

if (process.mainModule === module) {
  if (argv.webserver !== 'no') {
    const server = rpc.Server.$create({
      websocket: 'websocket' in argv,
      headers: {
        'Access-Control-Allow-Origin': argv.cors || '*'
      }
    })

    let methods = require('./rpc')(argv, core(), network, db)
    server.expose('core', decorate(methods, [
      require('./access')(argv, db)
    ]))

    server.listen(argv.webport || 3041, argv.webbind || '0.0.0.0')
  }
} else {
  module.exports = core()
}
