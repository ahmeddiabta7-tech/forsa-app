-- Example products to start the catalog (prices in EGP). Edit or remove them from the admin panel.
insert into public.products
  (name_en, name_ar, description_en, description_ar, category, factory_code, region, quality_score,
   wholesale_price, min_price, suggested_price, ship_days, image_url, stock)
values
 ('Classic cotton shirt', 'قميص قطن كلاسيك', 'Egyptian cotton, regular fit, sizes S–XXL.', 'قطن مصري، قصّة عادية، مقاسات من S إلى XXL.', 'Clothing', 'FT-104', 'Delta', 4.8, 320, 420, 520, 2, 'products/p1.jpg', 120),
 ('Striped satin pajama set', 'بيجامة ساتان مقلمة', 'Two-piece satin set, sizes S–XL.', 'طقم ساتان قطعتين، مقاسات من S إلى XL.', 'Clothing', 'FT-104', 'Delta', 4.8, 260, 350, 430, 2, 'products/p2.jpg', 80),
 ('Kids fleece hoodie', 'هودي أطفال فليس', 'Warm fleece hoodie for ages 3–12.', 'هودي فليس دافي للأعمار من ٣ إلى ١٢ سنة.', 'Clothing', 'FT-117', 'Greater Cairo', 4.6, 210, 290, 360, 3, 'products/p3.jpg', 150),
 ('Handmade stoneware mug', 'مج فخار يدوي', 'Hand-glazed stoneware mug, 350 ml.', 'مج فخار مطلي يدويًا، ٣٥٠ مل.', 'Home', 'FH-203', 'Greater Cairo', 4.9, 120, 170, 220, 2, 'products/p4.jpg', 200),
 ('Oak serving board', 'لوح تقديم خشب', 'Solid wood serving board, 40 × 25 cm.', 'لوح تقديم من الخشب الطبيعي، ٤٠ × ٢٥ سم.', 'Home', 'FH-211', 'Greater Cairo', 4.7, 150, 220, 290, 3, 'products/p5.jpg', 60),
 ('Woven palm baskets', 'سلال خوص منسوجة', 'Set of 3 handwoven palm-leaf baskets.', 'طقم ٣ سلال خوص منسوجة يدويًا.', 'Home', 'FH-208', 'Greater Cairo', 4.5, 140, 200, 260, 2, 'products/p6.jpg', 90),
 ('Leather bifold wallet', 'محفظة جلد', 'Genuine leather wallet with 6 card slots.', 'محفظة جلد طبيعي بـ٦ أماكن للكروت.', 'Accessories', 'FA-305', 'Greater Cairo', 4.8, 160, 230, 300, 1, 'products/p7.jpg', 140),
 ('Handmade soap trio', 'طقم ٣ صابون يدوي', 'Three natural handmade soaps, 100 g each.', 'ثلاث صابونات طبيعية يدوية، ١٠٠ جم لكل واحدة.', 'Beauty', 'FB-402', 'Alexandria', 4.7, 75, 120, 160, 3, 'products/p8.jpg', 300),
 ('Pure argan hair oil', 'زيت أرجان للشعر', 'Cold-pressed argan oil, 50 ml.', 'زيت أرجان معصور على البارد، ٥٠ مل.', 'Beauty', 'FB-402', 'Alexandria', 4.7, 110, 170, 220, 3, 'products/p9.jpg', 180);
