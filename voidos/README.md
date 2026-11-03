# VoidOS

Máy tính ảo chạy trên trình duyệt: CPU 16 bit, RAM, storage, BIOS, kernel và hệ điều hành VoidOS tự xây từ đầu.

## Trạng thái
- Phase 0: kiến trúc + CI/CD (GitHub Actions → GitHub Pages) ✅
- Phase 1: CPU emulator (`src/hardware/cpu.js`, `alu.js`, `registers.js`, `instruction/instruction-set.js`) ✅
- Phase 2: RAM vật lý (tới 16 MiB, giới hạn theo thiết bị), MMU phân trang 4 KB (R/W/X), cấp phát frame, hexdump ✅
- Phase 3+: xem roadmap trong spec dự án.

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
