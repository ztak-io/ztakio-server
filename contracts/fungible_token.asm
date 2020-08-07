# This is a contract template to create fungible tokens
# It receives 5 parameters
# 1) path
# 2) decimals
# 3) name
# 4) tokenVersion
# 5) author

NAMESPACE {{{path}}}
META "Info" '{"decimals": {{{decimals}}} }'
META "Name" "{{{name}}}"
META "Version" "{{{tokenVersion}}}"
META "Author" "{{{author}}}"

ENTRY "issuance" issuance
ENTRY "send" send
ENTRY "sendfrom" sendfrom # sends from an escrowed cache
ENTRY "escrow" escrow # escrows funds to a specially owned cache
ENTRY "balance" balance # returns balance of the stack top

DEPLOY deploy
END

:deploy
  OWNER
  RET 0

:issuance
  OWNER
  POP amount
  PUSHV caller
  GETI 0
  PUSHR amount
  PLUS
  PUSHV caller
  SWAP
  PUT
  PUSHI 1
  VERIFY "error-on-issuance"
  RET 1

:send
  POP memo
  POP amount
  POP destination
  PUSHV caller
  GETI 0 # Gets sender amount as integer, default to 0 if not available
  PUSHR amount
  SWAP
  MINUS
  JLZ send_invalid_amount # If remaining is less than 0, send is invalid
  PUSHV caller
  SWAP
  PUT
  PUSHR destination
  GETI 0 # Gets current destination balance
  SINK # Removes the destination address
  PUSHR amount
  PLUS
  PUSHR destination
  SWAP
  PUT # sets the new destination amount
  PUSHV caller
  CALL _cleanup_address
  PUSHI 1
  VERIFY "error-during-send"
  RET 0
:send_invalid_amount
  PUSHI 0
  VERIFY "insufficient-balance-on-send"
  RET 0

:escrow
  POP amount
  POP destination
  PUSHV caller
  GETI 0 # Gets sender amount as integer, default to 0 if not available
  PUSHR amount
  SWAP
  MINUS
  JLZ escrow_invalid_amount # If remaining is less than 0, send is invalid
  PUSHV caller
  SWAP
  PUT
  PUSHR destination
  GETI 0 # Gets current destination balance
  PUSHR amount
  PLUS
  PUT # sets the new destination amount
  PUSHV caller
  CALL _cleanup_address

  PUSHI 1
  VERIFY "error-during-escrow"
  RET 0
:escrow_invalid_amount
  PUSHI 0
  VERIFY "insufficient-balance-on-escrow"
  RET 0

:sendfrom
  POP amount
  POP destination
  POP source
  PUSHR source
  GETI 0 # Gets sender amount as integer, default to 0 if not available
  PUSHR amount
  SWAP
  MINUS
  JLZ sendfrom_invalid_amount # If remaining is less than 0, send is invalid
  PUSHR source
  SWAP
  PUT
  PUSHR destination
  GETI 0 # Gets current destination balance
  SINK
  PUSHR amount
  PLUS
  PUSHR destination
  SWAP
  PUT # sets the new destination amount
  PUSHR source
  CALL _cleanup_address

  PUSHI 1
  VERIFY "error-on-sendfrom"
  RET 0
:sendfrom_invalid_amount
  PUSHI 0
  VERIFY "insufficient-balance-on-sendfrom"
  RET 0

:balance
  GETI 0
  RET 1

# Maintain the contract tidy and small, no dangling 0s
:_cleanup_address
  POP address
  PUSHR address
  GETI -1
  JNZ _cleanup_end
  PUSHR address
  DEL
:_cleanup_end
  RET 0
