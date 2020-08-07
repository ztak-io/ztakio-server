const log = require('log').get('ztakio-server').get('access')

module.exports = (cfg, db) => {
  let mw = () => {}

  if (cfg.webbasicauth) {
    let authparams = cfg.webbasicauth.split(':')

    if (authparams.length === 2) {
      mw = async (req, res) => {
        if (req.headers.authorization) {
          let auth = req.headers.authorization.split(' ')
          let token = Buffer.from(auth.pop(), 'base64').toString('utf8').split(':')

          if (token.length === 2) {
            if (authparams[0] === token[0] && authparams[1] === token[1]) {
              return
            } else {
              throw new Error('not authorized')
            }
          } else {
            throw new Error('bad authorization')
          }
        } else {
          throw new Error('requires authorization')
        }
      }
    } else {
      log.warn('--webbasicauth must be of the form user:pass')
    }
  } // Can include further authorization schemes here

  return mw
}
