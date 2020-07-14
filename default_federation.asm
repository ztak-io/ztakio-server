NAMESPACE /default

DEPLOY root
END

:root
  META "Name" "Default Namespace"
  META "Version" "1"
  META "Author" "John Villar"
  META "Info" '{"icon": "https://ztak.io/icons/ztakio.png", "website": "https://ztak.io"}'
  ENTRY "federation" poa

  PUSHI 0
  PUSHS "Put your Proof-of-authority Address here"
  PUT
  DROP2
  RET 0

:poa
  LOG "Default poa"
  POP signature
  POP blockhash
  PUSHI 0
  PUSHI 10 # Up to 10 federation participants
  PUSHI 1 # Iterate one by one
  PUSHI 0
  ITER poaverify
  VERIFY
  END

:poaverify
  GET
  JNIL poaexit
  PUSHPR blockhash
  PUSHPR signature
  CHECKSIG
  RET 1
:poaexit
  PUSHI -1
  RET 1
