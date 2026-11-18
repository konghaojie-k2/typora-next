# 动态 SVG 演示（L1 / L2）

下面这张图用 `<g data-part>` 把三个部件分组。悬停任一部件会高亮，
图下方的图例与图内双向联动；点「下一步」可以按 `data-order` 逐段演示。

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 300" width="100%" role="img">
  <title>热传导三段示意</title>
  <desc>热源、导热层与散热端三个部件的顺序演示</desc>
  <rect x="0" y="0" width="680" height="300" rx="12" fill="#F1EFE8"/>

  <g data-part="heat-source" data-label="热源" data-order="1">
    <rect x="70" y="110" width="120" height="80" rx="8" fill="#F5C4B3" stroke="#993C1D" stroke-width="1.5"/>
    <text x="130" y="155" text-anchor="middle" font-size="13" fill="#993C1D">热源</text>
  </g>

  <g data-part="conductor" data-label="导热层" data-order="2">
    <rect x="220" y="120" width="240" height="60" rx="6" fill="#FAC775" stroke="#BA7517" stroke-width="1.5"/>
    <text x="340" y="156" text-anchor="middle" font-size="13" fill="#854F0B">导热层</text>
  </g>

  <g data-part="sink" data-label="散热端" data-order="3">
    <rect x="490" y="100" width="120" height="100" rx="8" fill="#B5D4F4" stroke="#185FA5" stroke-width="1.5"/>
    <text x="550" y="155" text-anchor="middle" font-size="13" fill="#185FA5">散热端</text>
  </g>

  <path d="M195 150 L215 150" fill="none" stroke="#5F5E5A" stroke-width="1.2"/>
  <path d="M465 150 L485 150" fill="none" stroke="#5F5E5A" stroke-width="1.2"/>
</svg>

正文继续。把本文件放进任意课程项目目录，即可在课程工作区看到交互控件。
