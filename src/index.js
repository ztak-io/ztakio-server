const fs = require('fs')
const {argv} = require('yargs')
const leveldown = require('leveldown')
const rpc = require('json-rpc2')

const ztakioDb = require('ztakio-db')
const ztakioCore = require('ztakio-core')

const decorate = require('./decorator')
const dbStatsLayer = require('./dbstats')

if (argv.conf) {
  mixConfig(argv.conf)
}
mixConfig('config.json')

function mixConfig(fname) {
  try {
    const ncfg = JSON.parse(fs.readFileSync(fname, 'utf8'))

    for (x in ncfg) {
      if (!(x in argv)) {
        argv[x] = ncfg[x]
      }
    }
  } catch(e) {
    console.log(`Error loading ${fname} config file: ${e.message}`)
  }
}

const db = dbStatsLayer(ztakioDb(leveldown(argv.datadir)))
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
    const websocketEnabled = 'websockets' in argv
    const webPort = argv.webport || 3041
    const webBind = argv.webbind || '0.0.0.0'
    const server = rpc.Server.$create({
      websocket: websocketEnabled,
      headers: {
        'Access-Control-Allow-Origin': argv.cors || '*'
      }
    })

    let methods = require('./rpc')(argv, core(), network, db)
    server.expose('core', decorate(methods, [
      require('./access')(argv, db)
    ]))

    server.listen(webPort, webBind)
    console.log(`HTTP server listening on ${webBind}:${webPort}` + (websocketEnabled?' (websockets enabled)':''))
  }
} else {
  module.exports = core()
}
