# This is a contract template to send tokens from one address to another
# It receives 4 parameters
# 1) path
# 2) destination
# 3) amount
# 4) memo (can be empty string)
# The called token must have a "send" entrypoint
# The send function must VERIFY on success
REQUIRE {{{path}}}

# Send
PUSHS "{{{destination}}}"
PUSHI {{{amount}}}
ECALL {{{path}}}:send

END
