const fs = require('fs')
const leveldown = require('leveldown')
const rpc = require('json-rpc2')

const ztakioDb = require('ztakio-db')
const ztakioCore = require('ztakio-core')

const decorate = require('./decorator')
const config = require('./config')

const db = startDb()
const network = ztakioCore.networks[config.network || 'mainnet']

function startDb() {
  let ndb = ztakioDb(leveldown(config.datadir))

  if (config.dbstats) {
    ndb = require('./dbstats')(ndb)
  }

  if (config.dbwatchers) {
    ndb = require('./dbwatch')(ndb)
  }

  if (config.dbindexer) {
    ndb = require('./dbindexer')(ndb)
  }

  return ndb
}

function core() {
  let ut = ztakioCore.utils(network)

  const executor = (callerAddress) => {
    const context = ztakioCore.asm.createContext(ut, db, callerAddress)
    return async (byteCode, onlyEval) => {
      try {
        context.loadProgram(byteCode)
        let res = await ztakioCore.asm.execute(context, null, onlyEval)
        return res
      } catch (e) {
        return e.message
      }
    }
  }

  return executor
}

function serve(ztakCore) {
  if (config.webserver !== 'no') {
    const websocketEnabled = 'websockets' in config
    const webPort = config.webport || 3041
    const webBind = config.webbind || '0.0.0.0'
    const server = rpc.Server.$create({
      websocket: websocketEnabled,
      headers: {
        'Access-Control-Allow-Origin': config.cors || '*'
      }
    })

    let methods = require('./rpc')(config, ztakCore, network, db)
    server.expose('core', decorate(methods, [
      require('./access')(config, db)
    ]))

    server.listen(webPort, webBind)
    console.log(`HTTP server listening on ${webBind}:${webPort}` + (websocketEnabled?' (websockets enabled)':''))
  }
}

if (process.mainModule === module) {
  serve(core())
} else {
  module.exports = { core, serve }
}
