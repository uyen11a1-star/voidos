; A variable in the writable .data page: counts 1..5
        MOVI R2, 5
again:  LOAD  R0, [counter]
        INC   R0
        STORE [counter], R0
        ADDI  R0, '0'
        PRINT R0
        DEC   R2
        JNE   again
        MOVI  R0, '\n'
        PRINT R0
        HALT

.data
counter: .word 0
