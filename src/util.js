const bs58check = require('bs58check')

const isAddress = (txt) => {
  try {
    let decoded = bs58check.decode(txt)
    return decoded.length == 21
  } catch (e) {
    return false
  }
}

module.exports = {
  isAddress
}
