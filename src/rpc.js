const ztak = require('ztakio-core')
const asm = require('ztakio-core')
const ztakiocorePkg = require('ztakio-core/package.json')
const ztakiodbPkg = require('ztakio-db/package.json')
const ztakioserverPkg = require('../package.json')

const startTime = BigInt(Date.now())
module.exports = (cfg, core, network, db) => {
  return {
    'info': async () => {
      return {
        'ztakio-core.version': ztakiocorePkg.version,
        'ztakio-db.version': ztakiodbPkg.version,
        'ztakio-server.version': ztakioserverPkg.version,
        'defaultAddressVersion': network.pubKeyHash,
        'dbStats': db.stats,
        'runningSeconds': ((BigInt(Date.now()) - startTime) / 1000n).toString()
      }
    },

    'get': async (key, encoding) => {
      if (!key.startsWith('/')) {
        throw new Error(`all keys must start with a /`)
      }

      if ('forceroot' in cfg) {
        if (!key.startsWith(cfg.forceroot)) {
          throw new Error(`this server only handles keys under the ${cfg.forceroot} branch`)
        }
      }

      let ret = await db.get(key)
      if (encoding) {
        ret = ret.toString(encoding)
      } else if (Buffer.isBuffer(ret)) {
        ret = ret.toString('hex')
      }
      return ret
    },

    'tx': async (envelope) => {
      const msg = ztak.openEnvelope(Buffer.from(envelope, 'hex'))

      const prog = Buffer.from(msg.data, 'hex')
      const executor = core(msg.from)
      return await executor(prog)
    }
  }
}
