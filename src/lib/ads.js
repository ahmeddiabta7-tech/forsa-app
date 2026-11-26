// AI media buyer (pilot): shared choices and the money math, the same rules as the "ad-agent" Edge Function.
export const AD_GOALS = ['auto', 'website', 'messages'];
export const AD_AGES = ['18-24', '25-34', '35-44', '45+'];
export const AD_DAILY = [100, 150, 250, 500];
export const AD_DAYS = [3, 5, 7, 14];
export const AD_DAILY_LIMIT = 5;
export const AD_MIN_DAILY = 50;
const REFUSAL = 0.75; // 20-30% of cash-on-delivery orders are refused in Egypt

export function adMath(product, price) {
  const wholesale = Number(product?.wholesale_price) || 0;
  const feePct = product?.owner_id && !product?.seller_made ? 0 : 10;
  const profit = Math.max(0, price - wholesale);
  const fee = Math.round(profit * feePct / 100);
  const net = profit - fee;
  const beCpa = Math.round(net * REFUSAL);
  return { price, wholesale, fee_pct: feePct, profit_per_piece: net, break_even_cpa: beCpa, target_cpa: Math.round(beCpa * 0.6), weak: beCpa < 40 };
}

export function ageRange(ages) {
  const list = ages?.length ? ages : ['18-24', '25-34'];
  const lo = Math.min(...list.map((a) => parseInt(a, 10)));
  const hi = list.includes('45+') ? 65 : Math.max(...list.map((a) => parseInt(a.split('-')[1], 10)));
  return { age_min: Math.max(18, lo), age_max: hi };
}

// Demo mode only: a simple local plan so the screens can be tested without Gemini.
export function demoAdPlan({ product, business, answers, link, lang, note }) {
  const m = adMath(product, answers.price);
  const name = (answers.ad_lang === 'ar' ? product.name_ar : product.name_en) || product.name_en;
  const objective = answers.goal === 'website' && link ? 'website_sales' : answers.goal === 'messages' || !link ? 'messages' : 'website_sales';
  const ar = answers.ad_lang === 'ar';
  const end = ar ? `بـ ${answers.price} جنيه بس.\nالدفع عند الاستلام، والتوصيل من 2 لـ 5 أيام.` : `Only EGP ${answers.price}.\nCash on delivery, delivered in 2-5 days.`;
  const ads = (ar
    ? [['مشكلة وحل', `محتاج ${name} يريّحك؟`], ['السعر', `${name} بسعر مش هتلاقيه تاني`], ['هدية', `هدية تفرّح أي حد بتحبه`]]
    : [['Problem → solution', `Need a ${name} that just works?`], ['Value', `${name} at a price you won't find again`], ['Gift', 'A gift anyone you love will enjoy']])
    .map(([angle, hook]) => ({ angle, hook, primary_text: `${hook}\n✔️ ${ar ? 'جودة مضمونة' : 'Quality checked'}\n✔️ ${ar ? 'مناسب للاستخدام اليومي' : 'Made for daily use'}\n${end}${note ? `\n(${note})` : ''}`,
      headline: name.slice(0, 38), cta: objective === 'website_sales' ? 'SHOP_NOW' : 'SEND_MESSAGE' }));
  const t = (en, a) => (lang === 'ar' ? a : en);
  const { age_min, age_max } = ageRange(answers.ages);
  return {
    objective, why: t('Messages let buyers ask before they order, which builds trust for cash on delivery.', 'الرسايل بتخلّي العميل يسأل قبل ما يطلب، وده بيبني ثقة مع الدفع عند الاستلام.'),
    product_insight: t(`Good for young buyers who want ${product.category || 'useful'} items at a fair price.`, 'مناسب للشباب اللي عايزين حاجة مفيدة بسعر معقول.'),
    interests: [], ads, budget_advice: t('Run it at least 3 days before judging.', 'سيبه 3 أيام على الأقل قبل ما تحكم عليه.'),
    tips: [t('Reply to every message within 5 minutes.', 'رد على كل رسالة خلال 5 دقايق.')],
    warning: m.weak ? t('Your profit per piece is small for ads. Try a higher price or a bundle.', 'ربحك في القطعة قليل على الإعلانات. جرّب سعر أعلى أو عرض قطعتين.') : '',
    math: m, link: link || '', audience: { all_egypt: answers.all_egypt, governorates: answers.governorates, age_min, age_max, gender: answers.gender, interests: [] },
    budget: { daily: answers.daily, days: answers.days, total: answers.daily * answers.days }, image_url: product.image_url, product_name: product.name_en,
    business_name: business.name, used_photo: true,
  };
}
