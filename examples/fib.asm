; Prints the first 10 Fibonacci numbers
        MOVI R1, 0          ; a
        MOVI R2, 1          ; b
        MOVI R6, 10         ; how many
loop:   MOV  R0, R1
        CALL print_num
        MOVI R0, ' '
        PRINT R0
        MOV  R3, R1
        ADD  R3, R2         ; t = a + b
        MOV  R1, R2         ; a = b
        MOV  R2, R3         ; b = t
        DEC  R6
        JNE  loop
        MOVI R0, '\n'
        PRINT R0
        HALT

; print_num: prints unsigned R0 in decimal. Clobbers R0, R3, R4, R5.
print_num:
        MOVI R4, 10
        MOVI R5, 0          ; digit count
pn_div: MOV  R3, R0
        MOD  R3, R4         ; R3 = R0 % 10
        DIV  R0, R4         ; R0 = R0 / 10
        PUSH R3             ; digits come out backwards: stack reverses them
        INC  R5
        CMPI R0, 0
        JNE  pn_div
pn_out: POP  R3
        ADDI R3, '0'
        PRINT R3
        DEC  R5
        JNE  pn_out
        RET
