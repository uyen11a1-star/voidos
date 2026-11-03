# VoidOS

Máy tính ảo chạy trên trình duyệt: CPU 16 bit, RAM, storage, BIOS, kernel và hệ điều hành VoidOS tự xây từ đầu.

## Trạng thái
- Phase 0: kiến trúc + CI/CD (GitHub Actions → GitHub Pages) ✅
- Phase 1: CPU emulator (`src/hardware/cpu.js`, `alu.js`, `registers.js`, `instruction/instruction-set.js`) ✅
- Phase 2: RAM vật lý (tới 16 MiB, giới hạn theo thiết bị), MMU phân trang 4 KB (R/W/X), cấp phát frame, hexdump ✅
- Phase 3: assembler 2 pass (label, `.equ/.org/.byte/.word/.string/.ascii/.space/.data`), disassembler, báo lỗi theo dòng ✅
- Phase 4+: xem roadmap trong spec dự án.

## CPU (VoidCPU)
16 bit, R0..R7, PC, SP, FLAGS (Z,N,C,V), không gian địa chỉ 64 KB. Lệnh 4 byte:
`[opcode][rd<<4 | rs][imm lo][imm hi]`. Chi tiết opcode: `src/instruction/instruction-set.js`.

## Bộ nhớ
CPU thấy không gian địa chỉ ảo 64 KB (16 trang × 4 KB). `src/hardware/mmu.js` dịch ảo→vật lý theo page table của process và kiểm tra quyền R/W/X (`PAGE_FAULT`, `PROTECTION_FAULT`). `src/os/memory-manager.js` cấp/giải phóng frame (xóa sạch khi cấp) và quản lý address space. `src/hardware/memory-inspector.js` xuất hex + ASCII.

## Lệnh
```
npm ci
npm test       # vitest
npm run dev    # dev server
npm run build  # ra thư mục dist/
```
Cần Node >= 20.19.

## Assembly (VoidCPU)
```
        MOVI  R1, msg        ; R1 = địa chỉ msg
loop:   LOADB R0, [R1]       ; đọc 1 byte
        CMPI  R0, 0
        JE    done
        PRINT R0
        INC   R1
        JMP   loop
done:   HALT
msg:    .string "Xin chào!\n"
```
- Bộ nhớ: `LOAD Rd,[addr]`, `LOADR/LOADB Rd,[Rs]`, `STORE [addr],Rs`, `STORER/STOREB [Rd],Rs`.
- Hằng số dùng biến thể `...I` (`MOVI`, `ADDI`, `SUBI`, `CMPI`).
- Số: `10`, `0x1F`, `0b101`, `'A'`, `'\n'`; biểu thức `label+4`, `$` = địa chỉ hiện tại.
- `.data` căn lên trang 4 KB kế tiếp: phần sau là trang **ghi được, không chạy được**; code là trang **chạy được, không ghi được**.
- Chuỗi mã hóa UTF-8. Chương trình tối đa 60 KB (trang trên cùng là stack).
- Ví dụ: `examples/hello.asm`, `fib.asm`, `counter.asm`.
