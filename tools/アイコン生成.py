# -*- coding: utf-8 -*-
# アイコン3種を1か所から生成する。手で3ファイル書くと必ずズレるため。
import io

ICONS = r'C:\Users\user\Documents\Projects\20260414_badminton-app\icons'

# 素の座標系での外接矩形はおよそ (57,145)-(455,482)、中心は (256,313)。
HEAD = ("M 100 215 L 116 145 L 192 196 "
        "C 224 178 288 178 320 196 "
        "L 396 145 L 412 215 "
        "C 452 268 464 360 432 410 "
        "C 398 462 330 482 256 482 "
        "C 182 482 114 462 80 410 "
        "C 48 360 60 268 100 215 Z")

# 三毛の模様。頭の形で切り抜くので、はみ出す前提で大きめに描く。
PATCH_ORANGE_TOP = ("M 24 120 L 214 120 "
                    "C 220 172 204 208 172 224 "
                    "C 134 242 66 236 36 216 "
                    "C 22 206 20 168 24 120 Z")
PATCH_BLACK_TOP = ("M 298 120 L 488 120 "
                   "C 494 176 480 212 448 228 "
                   "C 410 246 346 236 318 212 "
                   "C 298 194 292 160 298 120 Z")
PATCH_ORANGE_CHEEK = ("M 374 392 C 414 382 446 400 442 428 "
                      "C 436 456 398 466 374 448 "
                      "C 354 434 354 400 374 392 Z")


def eye(cx, color):
    return """      <g stroke="{c}" stroke-width="15">
        <path d="M {a} 255 L {cx} 282"/>
        <path d="M {b} 255 L {cx} 282"/>
        <path d="M {cx} 282 L {cx} 320"/>
        <path d="M {l} 295 L {r} 295"/>
        <path d="M {l} 310 L {r} 310"/>
      </g>""".format(c=color, cx=cx, a=cx - 29, b=cx + 29, l=cx - 22, r=cx + 22)


def cat(uid):
    return """    <defs>
      <clipPath id="{uid}"><path d="{head}"/></clipPath>
    </defs>

    <!-- 顔のベース -->
    <path d="{head}" fill="#FFFFFF"/>

    <!-- 三毛の模様（顔の形で切り抜く） -->
    <g clip-path="url(#{uid})">
      <path d="{o1}" fill="#E59B37"/>
      <path d="{b1}" fill="#3B3B3B"/>
      <path d="{o2}" fill="#E59B37"/>
    </g>

    <g stroke="#1A1A1A" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <!-- 耳の内側 -->
      <path fill="#F2A9BC" stroke-width="9" d="M 121 168 L 176 201 L 113 208 Z"/>
      <path fill="#F2A9BC" stroke-width="9" d="M 391 168 L 399 208 L 336 201 Z"/>

      <!-- 顔の輪郭 -->
      <path stroke-width="15" d="{head}"/>

      <!-- 目：オッドアイの ¥ -->
{eyeL}
{eyeR}

      <!-- ヒゲ -->
      <g stroke-width="9">
        <path d="M 170 366 L 66 342"/>
        <path d="M 164 386 L 58 384"/>
        <path d="M 170 406 L 74 428"/>
        <path d="M 342 366 L 446 342"/>
        <path d="M 348 386 L 454 384"/>
        <path d="M 342 406 L 438 428"/>
      </g>

      <!-- 鼻 -->
      <path fill="#EE9BB0" stroke-width="9" d="
        M 230 352 Q 256 342 282 352 Q 274 384 256 386 Q 238 384 230 352 Z"/>

      <!-- 鼻袋（大きめのω） -->
      <path stroke-width="13" d="M 256 386 L 256 404"/>
      <path stroke-width="13" d="M 256 404 C 250 450 196 458 176 418"/>
      <path stroke-width="13" d="M 256 404 C 262 450 316 458 336 418"/>
    </g>""".format(uid=uid, head=HEAD, o1=PATCH_ORANGE_TOP, b1=PATCH_BLACK_TOP,
                   o2=PATCH_ORANGE_CHEEK,
                   eyeL=eye(175, '#1565C0'), eyeR=eye(337, '#D81B60'))


FIT = 'translate(256 256) scale({s}) translate(-256 -313)'


def write(name, vb, head, scale, uid):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}">\n'
           '{head}'
           '  <g transform="{tr}">\n'
           '{body}\n'
           '  </g>\n'
           '</svg>\n').format(vb=vb, head=head, tr=scale, body=cat(uid))
    io.open(ICONS + '\\' + name, 'w', encoding='utf-8').write(svg)
    print(name, len(svg), 'bytes')


bg = '  <!-- 背景（アプリのテーマカラー） -->\n  <rect width="{w}" height="{w}" fill="#2E7D32" rx="{r}"/>\n'

# 通常アイコン：顔を大きく（拡大 1.06 で横幅は画面の約86%）
write('icon-512.svg', 512, bg.format(w=512, r=64), FIT.format(s=1.06), 'head512')
write('icon-192.svg', 192, bg.format(w=192, r=24), 'scale(0.375) ' + FIT.format(s=1.06), 'head192')

# マスカブル：円形に切り抜かれても耳が欠けないよう小さめにする
write('icon-maskable.svg', 512,
      '  <!-- マスカブル用: 全面背景。円形マスク(半径40%)でも欠けない大きさにしている -->\n'
      '  <rect width="512" height="512" fill="#2E7D32"/>\n',
      FIT.format(s=0.90), 'headmask')
