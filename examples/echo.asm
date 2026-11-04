; Echo: reads characters from stdin (INPUT blocks until you type) and prints them. Type q to quit.
loop:   INPUT R0
        CMPI  R0, 'q'
        JE    done
        PRINT R0
        JMP   loop
done:   HALT
