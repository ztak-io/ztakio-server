# This is a contract template to issue more tokens
# It receives 2 parameters
# 1) path
# 2) amount
# The called token must have an "issuance" entrypoint
# The issuance function must return 1 on success
REQUIRE {{{path}}}

# Issuance
PUSHI {{{amount}}}
ECALL {{{path}}}:issuance

END
