import struct, zlib, math

def make_icon(size):
    cx, cy = size/2, size/2
    r = size/2
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            dx, dy = x-cx, y-cy
            dist = math.sqrt(dx*dx+dy*dy)
            if dist >= r*0.95:
                row.append((0,0,0,0)); continue
            t = dist/r
            if t < 0.2:
                row.append((255,220,200,255))
            elif t < 0.5:
                row.append((232,0,26,255))
            elif t < 0.75:
                row.append((160,0,10,255))
            else:
                a = int(255*(1-(t-0.75)/0.2))
                row.append((100,0,5,max(0,a)))
        pixels.append(row)
    
    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r2,g,b,a in row:
            raw += bytes([r2,g,b,a])
    
    def chunk(name, data):
        c = name+data
        return struct.pack('>I',len(data))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
    
    ihdr = struct.pack('>IIBBBBB',size,size,8,6,0,0,0)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',ihdr)+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')

with open('/home/claude/logat-app/icon.png','wb') as f:
    f.write(make_icon(512))
print("done")
