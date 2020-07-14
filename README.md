ztakio-server
===

A default web/websocket/sockets Ztak.io server


Command line arguments:
===

 - conf: load json configuration from this file ( default: no config ).
   * Arguments on the command line will override the ones in the config file.
   * Arguments key must be the same as the command line equivalents.
   * It's assumed that all values are strings
 - datadir: path to the data directory where the database will be stored
 - network: what network to use, can be mainnet or testnet
 - webserver: wether to enable the http/websockets server ( default: yes )
 - cors: 'Access-Control-Allow-Origin' header ( default: * )
 - webport: port to listen http/websocket ( default: 3041 )
 - webbind: address to bind the http/websocket ( default: 0.0.0.0 )
 - forceroot: all get and write calls must be child of this root
