# VoidOS

Máy tính ảo chạy trên trình duyệt: CPU 16 bit, RAM, storage, BIOS, kernel và hệ điều hành VoidOS tự xây từ đầu.

## Trạng thái
- Phase 0-3: CI/CD, CPU, RAM + MMU phân trang, assembler ✅
- Phase 4-7: filesystem VoidFS lưu bằng IndexedDB (tự sửa lỗi khi mount), BIOS → bootloader (bytecode chạy trên VoidCPU) → kernel, system call, process manager (round-robin), định dạng executable `.vx`, shell, cấu hình, sao lưu ✅
- Phase 8: desktop (cửa sổ kéo/thu nhỏ/phóng to/đổi cỡ, taskbar, Start menu, menu chuột phải/nhấn giữ, thông báo, đồng hồ) ✅
- Phase 9: ứng dụng Terminal, Tệp, Soạn thảo (tô màu Assembly, tự lưu bản nháp), Giám sát, Cài đặt; chạy chương trình `.vx` trong cửa sổ, cài/gỡ ứng dụng ✅
- Phase 10: khôi phục cửa sổ sau khi tải lại, xuất/nhập sao lưu trong Cài đặt, lưu khi ẩn tab ✅
- Phase 11-12: test đầu-cuối (boot → desktop → reboot → tải lại trang), service worker chạy offline sau lần tải đầu ✅

- Phase 13 (PC thật để dùng): trình duyệt nhiều tab (dấu trang, lịch sử, YouTube nhúng, mở trang cục bộ trong sandbox), trình phát nhạc nền (4 đài tổng hợp bằng WebAudio + nhạc từ ổ đĩa + stream URL, nút trên taskbar), 8 hình nền vẽ bằng code + ảnh của tôi, Ảnh, Máy tính, màn hình khóa, đồng hồ trên nền, icon SVG, giao diện kính mờ, độ phân giải "Tự động" ✅

- Phase 14: app **Video** (YouTube trong VoidOS: trang chủ thịnh hành + tìm kiếm qua YouTube Data API bằng key miễn phí của người dùng, phát bằng trình phát nhúng chính thức, yêu thích, lịch sử), **chuột ảo** (touchpad nổi + con trỏ, nhấp/nhấp đúp/chuột phải/giữ-kéo/cuộn), **Cỡ giao diện** (phóng to nút và chữ), sửa lỗi YouTube "Error 153" khi nhúng không có referrer ✅

Giới hạn đã biết: trình duyệt chạy trang web bằng iframe nên **nhiều trang chặn nhúng** (Google, Facebook, GitHub...); các trang đó mở ở tab ngoài. Wikipedia hiển thị tại chỗ; YouTube dùng app Video. Chuột ảo không nhấp được vào bên trong trang web trong khung (cross-origin), hãy chạm trực tiếp. Video cần API key (Cài đặt → Hệ thống); key nằm trên ổ đĩa ảo và trong bản sao lưu; Google giới hạn khoảng 100 lượt tìm kiếm mỗi ngày. Quay lại/Tiến chỉ theo trang mở từ thanh địa chỉ. Chưa có ngôn ngữ giao diện khác tiếng Việt, kéo-thả tệp, GPU chưa nối vào desktop; chưa kiểm tra trên thiết bị thật (cảm ứng, âm thanh nghe bằng tai, YouTube API từ trình duyệt).

## Trang
- `index.html`: bật nguồn → boot → desktop.
- `lab.html`: phòng thí nghiệm Assembly (soạn, biên dịch, listing, hexdump RAM).

## Cấu trúc
`src/hardware` CPU/RAM/MMU/GPU · `src/instruction` ISA + assembler · `src/os` kernel, filesystem, syscalls · `src/core` boot, computer, config · `src/desktop` window manager, taskbar, start menu · `src/applications` ứng dụng · `src/storage` IndexedDB, backup · `tests/` vitest (jsdom cho giao diện).

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
