# -*- coding: utf-8 -*-
# アイコン3種を1か所から生成する。手で3ファイル書くと必ずズレるため。
#
# 絵柄：ラケット＋バドミントンのシャトル＋テニスボール。
# 「ゆるっとマッチ」はバドミントンに限らない名前なので、両方の球技を出している。
#
# 実行：python tools/アイコン生成.py

import io

ICONS = r'C:\Users\user\Documents\Projects\20260414_badminton-app\icons'
BG = '#2E7D32'   # アプリのテーマカラー

# 素の座標系での外接矩形は (84,81)-(440,404)、中心は (262,243)、大きさは 356×323。
# 中心から一番遠い点までは 217。いずれもブラウザで実測した値
# （図形の輪郭を点で拾って測る。回転した図形は外接矩形の角が実物より外に出るため）。
CENTER = (262, 243)
FIT = 'translate(256 256) scale({s}) translate(-{cx} -{cy})'


def racket():
    """ラケット。真上向きで描いてから傾ける。"""
    return """    <!-- ラケット -->
    <g transform="rotate(-18 200 250)">
      <ellipse cx="200" cy="185" rx="86" ry="98" fill="none" stroke="#FFFFFF" stroke-width="18"/>
      <g stroke="#FFFFFF" stroke-width="6" opacity="0.6">
        <path d="M 126 150 H 274"/>
        <path d="M 122 185 H 278"/>
        <path d="M 126 220 H 274"/>
        <path d="M 162 103 V 267"/>
        <path d="M 200 95 V 275"/>
        <path d="M 238 103 V 267"/>
      </g>
      <rect x="182" y="276" width="36" height="124" rx="14" fill="#FFFFFF"/>
      <g stroke="{bg}" stroke-width="7" stroke-linecap="round">
        <path d="M 184 310 H 216"/>
        <path d="M 184 336 H 216"/>
        <path d="M 184 362 H 216"/>
      </g>
    </g>""".format(bg=BG)


def shuttle():
    """シャトル。コルクを下にして描いてから、飛んでいる向きに傾ける。"""
    return """    <!-- バドミントンのシャトル -->
    <g transform="translate(360 176) rotate(30)">
      <path d="M -21 -12 L -44 -84 L 44 -84 L 21 -12 Z" fill="#FFFFFF"/>
      <g stroke="{bg}" stroke-width="5" stroke-linecap="round">
        <path d="M -8 -16 L -17 -80"/>
        <path d="M 8 -16 L 17 -80"/>
        <path d="M -21 -12 H 21"/>
      </g>
      <path d="M -21 -12 Q -21 14 0 14 Q 21 14 21 -12 Z" fill="#FFFFFF"/>
    </g>""".format(bg=BG)


def ball():
    """テニスボール。差し色になるよう黄緑にする。"""
    return """    <!-- テニスボール -->
    <g transform="translate(382 352)">
      <circle r="52" fill="#D4E157"/>
      <g fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round">
        <path d="M -46 -24 C -16 -4 16 -4 46 -24"/>
        <path d="M -46 24 C -16 4 16 4 46 24"/>
      </g>
    </g>"""


def art():
    return '\n\n'.join([racket(), shuttle(), ball()])


def write(name, vb, head, transform):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}">\n'
           '{head}'
           '  <g transform="{tr}">\n'
           '{body}\n'
           '  </g>\n'
           '</svg>\n').format(vb=vb, head=head, tr=transform, body=art())
    io.open(ICONS + '\\' + name, 'w', encoding='utf-8').write(svg)
    print(name, len(svg), 'bytes')


bg_rounded = ('  <!-- 背景（アプリのテーマカラー） -->\n'
              '  <rect width="{w}" height="{w}" fill="' + BG + '" rx="{r}"/>\n')

# 通常アイコン
write('icon-512.svg', 512, bg_rounded.format(w=512, r=64), FIT.format(s=1.20, cx=CENTER[0], cy=CENTER[1]))
write('icon-192.svg', 192, bg_rounded.format(w=192, r=24), 'scale(0.375) ' + FIT.format(s=1.20, cx=CENTER[0], cy=CENTER[1]))

# マスカブル：円形に切り抜かれても欠けないよう小さめにする
write('icon-maskable.svg', 512,
      '  <!-- マスカブル用: 全面背景。円形マスク(半径40%)でも欠けない大きさにしている -->\n'
      '  <rect width="512" height="512" fill="' + BG + '"/>\n',
      FIT.format(s=0.92, cx=CENTER[0], cy=CENTER[1]))
