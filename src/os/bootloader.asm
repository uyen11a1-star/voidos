; VoidBoot 1.0 - runs on the VoidCPU. BIOS services: SYSCALL 1 = read file, SYSCALL 2 = hand over to kernel.
        MOVI  R1, banner
        CALL  puts
        MOVI  R0, kpath
        MOVI  R1, kbuf
        MOVI  R2, 512
        SYSCALL 1               ; R0 = bytes read, 0xFFFF = error
        CMPI  R0, 0xFFFF
        JE    nokernel
        MOV   R7, R0            ; R7 = kernel size
        MOVI  R1, kbuf
        MOVI  R4, magic
        MOVI  R5, 4
chk:    LOADB R2, [R1]
        LOADB R3, [R4]
        CMP   R2, R3
        JNE   badmagic
        INC   R1
        INC   R4
        DEC   R5
        JNE   chk
        MOVI  R1, okmsg
        CALL  puts
        MOV   R0, R7
        SYSCALL 2               ; BIOS takes the image from memory and starts the kernel
        HALT
nokernel:
        MOVI  R1, m_nokernel
        CALL  puts
        HALT
badmagic:
        MOVI  R1, m_bad
        CALL  puts
        HALT
puts:   LOADB R0, [R1]
        CMPI  R0, 0
        JE    puts_end
        PRINT R0
        INC   R1
        JMP   puts
puts_end:
        RET
banner:     .string "VoidBoot 1.0\n"
kpath:      .string "/boot/kernel.vx"
magic:      .ascii  "VKRN"
okmsg:      .string "Kernel image verified\n"
m_nokernel: .string "boot: kernel not found\n"
m_bad:      .string "boot: bad kernel signature\n"
.data
kbuf:       .space 512
