const fs = require('fs')
const {argv} = require('yargs')

if (argv.conf) {
  mixConfig(argv.conf)
}
mixConfig('config.json')

function mixWeak(ob) {
  for (x in ob) {
    if (!(x in argv)) {
      argv[x] = ob[x]
    }
  }
}

function mixConfig(fname) {
  try {
    const ncfg = JSON.parse(fs.readFileSync(fname, 'utf8'))
    mixWeak(ncfg)
  } catch(e) {
    console.log(`Error loading ${fname} config file: ${e.message}`)
  }
}

mixWeak({
  webport: 3041,
  webbind: '0.0.0.0',
  webserver: 'yes',
  connect: 'localhost'
})

module.exports = argv
