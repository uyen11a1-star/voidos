; VoidOS hello world
        MOVI  R1, msg
loop:   LOADB R0, [R1]      ; next byte of the string
        CMPI  R0, 0         ; 0 = end
        JE    done
        PRINT R0
        INC   R1
        JMP   loop
done:   HALT
msg:    .string "Xin chào VoidOS!\n"
