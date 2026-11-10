# cv-orman

**[sergi.mertsoylu.dev](https://sergi.mertsoylu.dev)** — açık kaynak projelerimin sanal ormanı.

Her public GitHub reposu bir ağaç. Orman, CV veya düz liste yerine **canlı bir sergi**: neyin büyüdüğünü, neyin ne kadar süredir susuz kaldığını, hangi dilin hangi türde kök saldığını bir bakışta okuyorsun.

## Ne işe yarar?

Portfolio’yu “repo listesi” olmaktan çıkarıp **mekân** yapar. Ziyaretçi:

- ormanı dolaşır (sürükle, zoom),
- bir ağaca tıklar,
- o projenin yıldız, commit, yaş ve sağlık özetini görür,
- tek tıkla GitHub’a gider.

Veri anlık uydurma değil: GitHub GraphQL’den gelir, periyodik yenilenir. Arşivlenmiş ve fork repolar ormana girmez — sadece orijinal, public, yaşayan projeler.

## Ormanı nasıl okursun?

| Gözlem | Anlam |
|--------|--------|
| **Boyut** | Büyüme skoru: yıldız + commit hacmi + yaş. Daha büyük ağaç = daha “gövdeli” proje. |
| **Renk / solma** | Sağlık: son push’tan bu yana geçen gün. Taze yeşil → susuz kahverengi; susuz ağaç yaprak da döker. |
| **Sıra** | Yaş: spiral yolun zirvesinde en eski repo, kapıda en yenisi. |
| **Tür (siluet)** | Ana dil. Meşe (TS/JS/Java…), çam (Rust/C/C++), sakura (Python/Ruby), huş (Go/PHP/HTML/CSS), palmiye (Swift), genel (diğer). |

Gündüz / gece teması siteyle birlikte değişir; düşük güçlü cihazlarda kalite basamakları otomatik düşer. WebGL yoksa veya sahne düşerse aynı repolar erişilebilir bir listede kalır.

## Neden orman?

Düz bir “Projects” grid’i herkeste aynı. Burada metafor bilinçli:

- **Büyüme** = ilgi + emek + zaman  
- **Sulama** = son commit (proje terk edilmiş mi, hâlâ bakılıyor mu?)  
- **Biyolojik çeşitlilik** = dil spektrumu  

Yani orman hem vitrin hem de sessiz bir aktivite haritası: hangi ağaçlar taze, hangileri soluyor, hangileri devasa.

## Ne değil?

- Çok kullanıcılı SaaS değil — tek kişinin sergisi.  
- Veritabanı yok; durum GitHub’dan türetilir.  
- Yeni feature platformu değil; tek sayfalık deneyim.

## Teknik iskelet (kısa)

Next.js + saf Three.js ile sıfırdan yazılmış bir voxel motoru (uçan ada, küp küp büyüyen ağaçlar, gece/gündüz geçişi); sunucu tarafta repo çekimi ve skorlama, istemcide sergi salonu. Ana site: [mertsoylu.dev](https://mertsoylu.dev).

---

*Mert Soylu · açık kaynak projelerin mekânsal portresi.*
