// Public pages (no login): #/privacy, #/terms, #/data-deletion. Needed by Meta before the Facebook connection.
// Plain-language, English + Arabic. Contact email comes from config.js (CONTACT_EMAIL).
import React from 'react';
import { useApp, Header } from '../core.jsx';
import { CONTACT_EMAIL } from '../config.js';

const UPDATED = '26 November 2026';
const mail = CONTACT_EMAIL ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> : null;

const EN = {
  privacy: {
    title: 'Privacy policy',
    body: [
      ['Who we are', 'Forsa (فرصة) is an Egyptian app that helps young people start a business: selling ready products, making their own products, getting websites and help with marketing and ads.'],
      ['What we collect', 'Your name, phone number, email, university (optional) and password (stored only as a secure code by our provider). Your businesses, products, orders, costs and payout details. Your customers\' names, phone numbers and addresses that you enter for delivery. Messages you send in the app. Your questions to the AI advisor and the AI ad plans you make.'],
      ['Facebook and Instagram (Meta)', 'If you connect your Facebook page and ad account, we receive an access permission from Meta that lets Forsa create, change, pause and read results of the ads you approve, and read basic information about the pages and ad accounts you choose. We do not get your Facebook password. We never post or spend money without your approval, and we never sell or share Meta data with others. You can disconnect at any time.'],
      ['How we use it', 'To run your account, deliver orders, pay you, show your analytics, give AI advice and ad plans, run the ads you approve, prevent fraud, and improve Forsa. AI features send only what is needed (for example product details and anonymous numbers) to our AI provider (Google Gemini); we do not send your customers\' names, phones or addresses to the AI.'],
      ['Who sees it', 'Only you and the Forsa team. Couriers get what they need to deliver an order. Partner agencies only see the requests assigned to them, without your phone or email. Our technical providers (Supabase for the database, GitHub Pages for hosting, Google for AI, Meta for ads) process data for us. We never sell your data.'],
      ['How long we keep it', 'While your account is open, and longer only when the law or open orders and payments require it.'],
      ['Your rights', 'You can see and edit your information in the app, disconnect Facebook, and ask us to delete your account and data (see the Data deletion page).'],
      ['Security', 'Data is protected by row-level security (each user can only reach their own data), encrypted connections and limited team access.'],
      ['Contact', null],
    ],
  },
  terms: {
    title: 'Terms of use',
    body: [
      ['Using Forsa', 'You must give true information, be at least 18 years old (or have a parent\'s permission), and use Forsa only for legal selling. One person, one account.'],
      ['Selling and orders', 'You set your selling price at or above the minimum price. Forsa confirms orders with customers, ships them, collects cash on delivery and pays your profit after delivery, following the profit rules shown in the app (including the 3-pieces rule). Forsa keeps the fee shown in the app. Do not place fake orders or orders for yourself to unlock profit.'],
      ['AI ads (pilot)', 'The AI media buyer writes ad plans for you. You review and approve every ad before it runs, and you choose the budget. Ads are paid by you directly to Meta with your own card; during the pilot Forsa charges no fee for this. Results are not guaranteed. You are responsible for ads you approve, and they must follow Meta\'s advertising rules and Egyptian law. Never promise free delivery or fake offers.'],
      ['Websites and connections', 'Seller websites and store connections need Forsa\'s approval and can be paused if they break these terms.'],
      ['Content', 'You own what you upload and allow Forsa to show it in the app, on your website and in ads you approve. Do not upload content you have no right to use.'],
      ['Ending', 'You can stop using Forsa at any time. Forsa may pause accounts that break these terms, after settling money that is owed.'],
      ['Changes', 'We may update these terms and will show the new date here.'],
      ['Contact', null],
    ],
  },
  deletion: {
    title: 'Data deletion',
    body: [
      ['Disconnect Facebook', 'In the Forsa app: Services → Media buying → My ad plans → Disconnect Facebook. Forsa deletes the Meta access permission right away. You can also remove Forsa from Facebook: Settings & privacy → Settings → Business integrations → Forsa → Remove.'],
      ['Delete your Forsa account and data', 'Send a deletion request from the email or phone number of your Forsa account to the contact below. We delete your account and personal data within 30 days. Order and payment records that the law requires us to keep are kept only for that purpose and then deleted.'],
      ['Contact', null],
    ],
  },
};

const AR = {
  privacy: {
    title: 'سياسة الخصوصية',
    body: [
      ['إحنا مين', 'فرصة تطبيق مصري بيساعد الشباب يبدأوا مشروعهم: بيع منتجات جاهزة، عمل منتجاتهم الخاصة، مواقع، ومساعدة في التسويق والإعلانات.'],
      ['بنجمع إيه', 'اسمك ورقمك وإيميلك وجامعتك (اختياري) وكلمة السر (محفوظة ككود آمن عند مزوّد الخدمة بس). مشاريعك ومنتجاتك وأوردراتك ومصاريفك وبيانات استلام فلوسك. أسماء وأرقام وعناوين عملائك اللي بتكتبها عشان التوصيل. الرسايل في التطبيق. أسئلتك للمستشار الذكي وخطط الإعلانات اللي بتعملها.'],
      ['فيسبوك وإنستجرام (ميتا)', 'لو ربطت صفحتك وحساب إعلاناتك، بناخد من ميتا إذن يخلّي فرصة تعمل وتعدّل وتوقف وتقرا نتايج الإعلانات اللي إنت بتوافق عليها، وتقرا بيانات بسيطة عن الصفحات وحسابات الإعلانات اللي بتختارها. مش بناخد كلمة سر فيسبوك. عمرنا ما ننشر أو نصرف فلوس من غير موافقتك، وعمرنا ما نبيع أو نشارك بيانات ميتا مع حد. تقدر تفصل الربط في أي وقت.'],
      ['بنستخدمها في إيه', 'تشغيل حسابك، توصيل الأوردرات، دفع فلوسك، التحليلات، النصايح وخطط الإعلانات بالذكاء الاصطناعي، تشغيل الإعلانات اللي بتوافق عليها، منع النصب، وتطوير فرصة. مميزات الذكاء الاصطناعي بتبعت بس اللي محتاجاه (زي تفاصيل المنتج وأرقام من غير أسماء) لمزوّد الذكاء الاصطناعي (جوجل جيميناي)، ومش بنبعت أسماء أو أرقام أو عناوين عملائك.'],
      ['مين بيشوفها', 'إنت وفريق فرصة بس. شركة الشحن بتاخد اللي محتاجاه للتوصيل. الوكالات الشريكة بتشوف الطلبات اللي متحوّلة ليها بس من غير رقمك أو إيميلك. مزوّدي الخدمة التقنيين (سوبابيز للبيانات، جيت هاب للاستضافة، جوجل للذكاء الاصطناعي، ميتا للإعلانات) بيشتغلوا على البيانات لحسابنا. عمرنا ما نبيع بياناتك.'],
      ['بنحتفظ بيها قد إيه', 'طول ما حسابك مفتوح، وأكتر بس لو القانون أو أوردرات وفلوس لسه مفتوحة محتاجين ده.'],
      ['حقوقك', 'تقدر تشوف وتعدّل بياناتك في التطبيق، تفصل فيسبوك، وتطلب مسح حسابك وبياناتك (شوف صفحة مسح البيانات).'],
      ['الأمان', 'البيانات محمية بحيث كل مستخدم يوصل لبياناته بس، واتصالات مشفّرة، وصلاحيات محدودة للفريق.'],
      ['التواصل', null],
    ],
  },
  terms: {
    title: 'شروط الاستخدام',
    body: [
      ['استخدام فرصة', 'لازم بياناتك تكون صحيحة، وسنك 18 سنة على الأقل (أو بموافقة ولي أمرك)، وتستخدم فرصة للبيع القانوني بس. كل شخص له حساب واحد.'],
      ['البيع والأوردرات', 'إنت بتحدد سعر البيع بشرط ميقلّش عن أقل سعر. فرصة بتأكد الأوردر مع العميل وتشحنه وتحصّل الفلوس عند الاستلام وتدفعلك ربحك بعد التسليم حسب قواعد الربح في التطبيق (ومنها قاعدة الـ3 قطع). فرصة بتاخد الرسوم الموضحة في التطبيق. ممنوع الأوردرات الوهمية أو الأوردرات لنفسك عشان تفتح الربح.'],
      ['إعلانات الذكاء الاصطناعي (تجريبي)', 'الميديا باير الذكي بيكتبلك خطط إعلانات. إنت بتراجع وتوافق على كل إعلان قبل ما يشتغل وبتختار الميزانية. فلوس الإعلانات بتدفعها إنت لميتا بكارتك، وفي الفترة التجريبية فرصة مش بتاخد رسوم على ده. النتايج مش مضمونة. إنت مسؤول عن الإعلانات اللي بتوافق عليها، ولازم تلتزم بقواعد إعلانات ميتا والقانون المصري. ممنوع توعد بتوصيل مجاني أو عروض مش حقيقية.'],
      ['المواقع والربط', 'مواقع البائعين وربط المتاجر محتاجين موافقة فرصة وممكن يتوقفوا لو خالفوا الشروط.'],
      ['المحتوى', 'اللي بترفعه ملكك، وبتسمح لفرصة تعرضه في التطبيق وعلى موقعك وفي الإعلانات اللي بتوافق عليها. متعرفعش محتوى ملكش حق تستخدمه.'],
      ['إنهاء الاستخدام', 'تقدر توقف استخدام فرصة في أي وقت. فرصة ممكن توقف الحسابات اللي بتخالف الشروط بعد تسوية الفلوس المستحقة.'],
      ['التعديلات', 'ممكن نحدّث الشروط ونكتب التاريخ الجديد هنا.'],
      ['التواصل', null],
    ],
  },
  deletion: {
    title: 'مسح البيانات',
    body: [
      ['فصل فيسبوك', 'من تطبيق فرصة: الخدمات ← ميديا باينج ← خطط إعلاناتي ← فصل فيسبوك. فرصة بتمسح إذن ميتا فورًا. وتقدر كمان تشيل فرصة من فيسبوك: الإعدادات والخصوصية ← الإعدادات ← Business integrations ← فرصة ← إزالة.'],
      ['مسح حسابك وبياناتك في فرصة', 'ابعت طلب مسح من الإيميل أو الرقم المسجّل في حسابك لعنوان التواصل تحت. بنمسح حسابك وبياناتك الشخصية خلال 30 يوم. سجلات الأوردرات والفلوس اللي القانون بيطلب نحتفظ بيها بتفضل للغرض ده بس وبعدين بتتمسح.'],
      ['التواصل', null],
    ],
  },
};

export function LegalPage({ kind }) {
  const { lang } = useApp();
  const page = (lang === 'ar' ? AR : EN)[kind] || EN.privacy;
  const contact = lang === 'ar'
    ? <>للأسئلة أو الطلبات: {mail || 'ابعتلنا من داخل تطبيق فرصة'}.</>
    : <>Questions or requests: {mail || 'message us from inside the Forsa app'}.</>;
  return (
    <div className="screen legal">
      <Header title="" back="/" />
      <h1 className="page-title">{page.title}</h1>
      <p className="small muted">{lang === 'ar' ? `آخر تحديث: ${UPDATED}` : `Last updated: ${UPDATED}`}</p>
      {page.body.map(([h, p]) => (
        <section key={h} className="card stack"><h3>{h}</h3><p>{p || contact}</p></section>
      ))}
      <p className="small legal-links"><a href="#/privacy">{lang === 'ar' ? 'الخصوصية' : 'Privacy'}</a> · <a href="#/terms">{lang === 'ar' ? 'الشروط' : 'Terms'}</a> · <a href="#/data-deletion">{lang === 'ar' ? 'مسح البيانات' : 'Data deletion'}</a></p>
    </div>
  );
}
