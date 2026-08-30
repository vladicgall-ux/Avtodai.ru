# Промпты для генерации 3D-графики и авто (Midjourney / Flux)

Стиль бренда: чистая 3D-графика, глубокий синий градиент (#2b6bff → #0e1f66),
мягкий студийный свет, минимализм, без лишнего текста на самом изображении
(текст добавляется отдельно поверх в HTML-баннере).

## 1. Герой-визуал для главного баннера
```
sleek modern sedan car, 3D render, isometric perspective, glossy deep blue
paint (#2b6bff), studio lighting, soft reflections, floating above a subtle
glowing platform, clean gradient background from bright blue to deep navy,
minimalist, high detail, octane render, 4k, no text, no logos
--ar 16:9 --style raw
```

## 2. Вертикальная афиша / Stories (герой на весь кадр)
```
3D isometric car key and car silhouette, futuristic minimal composition,
glowing blue and teal accents, floating geometric shapes, deep blue to navy
gradient background, vertical composition, premium tech branding aesthetic,
clean negative space at top and bottom for text overlay, octane render, 4k
--ar 9:16 --style raw
```

## 3. Иконка/эмблема сервиса (для favicon, аватара бота)
```
minimal flat icon of a car with a key, single continuous line style, brand
blue color (#2b6bff) on white background, geometric, rounded corners,
app-icon style, centered, no gradients, no shadow, vector look
--ar 1:1 --style raw
```

## 4. Карточка «Сдай свой авто» (для раздела личного кабинета/промо-поста)
```
friendly 3D character handing over car keys to another character, both
stylized low-poly figures, warm handshake moment, blue and white color
palette matching a tech brand, soft studio lighting, clean gradient
background, no text, isometric view
--ar 4:5 --style raw
```

## 5. Карта России с точками городов (для баннера «вся Россия»)
```
stylized minimal map of Russia made of glowing blue dots and connecting
light lines, dark navy background, futuristic network aesthetic, several
brighter glowing pins marking major cities, clean and modern, no labels,
no text
--ar 16:9 --style raw
```

## 6. Набор авто разных классов (эконом/комфорт/бизнес/внедорожник)
```
four different car silhouettes (compact hatchback, sedan, business sedan,
SUV) arranged in a row, consistent 3D isometric style, glossy blue and
white paint variations, soft studio lighting, clean light gradient
background, minimal shadows, no text, no license plates
--ar 16:9 --style raw
```

## Рекомендации по постобработке
- Экспортировать в PNG с прозрачным фоном там, где это возможно (герой-авто,
  ключ, персонажи) — упрощает встраивание в HTML-баннеры поверх готового
  градиента вместо повторной генерации фона.
- Держать единую цветовую палитру: `#2b6bff` (основной), `#0e1f66` (тёмный),
  `#00e0c6` (акцент), белый — совпадает с цветами в `banner.html` и
  `poster.html`, чтобы сгенерированная графика и HTML-баннеры сочетались.
