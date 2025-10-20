<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
  
</div>
<p align="center">
   <a href="#quickstart-tldr">ابدأ الآن</a> · 
   <a href="https://docs.insforge.dev/introduction">توثيق</a> · 
   <a href="https://discord.gg/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.gg/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge هو البديل الأصلي لـ Supabase.** نعمل على تطوير ميزات Supabase بطريقة تعتمد على الذكاء الاصطناعي، مما يُمكّن وكلاء الذكاء الاصطناعي من بناء وإدارة تطبيقات متكاملة بشكل مستقل.
## الميزات الرئيسية وحالات الاستخدام

### الميزات الأساسية:
- **المصادقة** - نظام إدارة مستخدمين متكامل
- **قاعدة بيانات** - مرونة في تخزين واسترجاع البيانات
- **التخزين** - إدارة وتنظيم الملفات
- **وظائف بدون خادم** - قوة حوسبة قابلة للتطوير
- **نشر الموقع** *(قريبًا)* - سهولة نشر التطبيقات

### حالات الاستخدام: بناء تطبيقات متكاملة باستخدام اللغة الطبيعية
- **ربط وكلاء الذكاء الاصطناعي بـ InsForge** - تمكين Claude أو GPT أو وكلاء الذكاء الاصطناعي الآخرين لإدارة الواجهة الخلفية
- **إضافة واجهة خلفية لمشاريع برمجة Vibe على غرار Lovable أو Bolt** - واجهة خلفية فورية للواجهات الأمامية المُولّدة بالذكاء الاصطناعي

## أمثلة سريعة:
<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>

<a id="quickstart-tldr"></a>
## البدء السريع (TL;DR)
### 1. تثبيت وتشغيل InsForge

**استخدام Docker (موصى به)**
المتطلبات الأساسية: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Run with Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. توصيل وكيل الذكاء الاصطناعي

تفضل بزيارة لوحة تحكم InsForge (افتراضيًا: http://localhost:7131)، وسجّل الدخول، واتبع دليل "التوصيل"(Connect)، ثم قم بإعداد خادم MCP الخاص بك.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>تسجيل الدخول إلى InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>تكوين اتصال MCP</em>
      </td>
    </tr>
  </table>
</div>

### 3. اختبر الاتصال

في وكيلك، أرسل:
```
InsForge is my backend platform, what is my current backend structure?
```

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>عينة من استدعاءات الاستجابة الناجحة لأدوات insforge MCP</em>
</div>

### 4. ابدأ باستخدام InsForge

ابدأ ببناء مشروعك في مجلد جديد! أنشئ تطبيقك التالي لإدارة المهام، أو نسخة من إنستغرام، أو منصتك الإلكترونية في ثوانٍ!

**نماذج لمقترحات المشروع:**
- "Build a todo app with user authentication"
- "Create an Instagram with image upload"

## بنيان

<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>



## المساهمة

**المساهمة**: إذا كنت مهتمًا بالمساهمة، يمكنك الاطلاع على دليلنا هنا [CONTRIBUTING.md](CONTRIBUTING.md). نحن نقدر حقًا طلبات السحب، ونقدر جميع أنواع المساعدة !

**الدعم**: إذا كنت بحاجة إلى أي مساعدة أو دعم، فنحن نستجيب على قناتنا [Discord channel](https://discord.gg/MPxwj5xVvW)، ولا تتردد في مراسلتنا عبر البريد الإلكتروني [info@insforge.dev](mailto:info@insforge.dev) أيضاً!


## التوثيق والدعم

### التوثيق
- **[الوثائق الرسمية](https://docs.insforge.dev/introduction)** - أدلة شاملة ومراجع لواجهات برمجة التطبيقات

### المجتمع
 - انضم إلى مجتمعنا النابض بالحياة **[Discord](https://discord.gg/D3Vf8zD2ZS)**
 - تابعنا للحصول على التحديثات والنصائح **[Twitter](https://x.com/InsForge_dev)**

### للتواصل
- **البريد الإلكتروني**: info@insforge.dev

## الترخيص
تم ترخيص هذا المشروع بموجب ترخيص Apache 2.0 - راجع ملف [LICENSE](LICENSE) للحصول على التفاصيل.

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
