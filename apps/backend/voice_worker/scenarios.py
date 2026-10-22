"""Registry skenario → persona/voice + spesifikasi drift & auditor.

Skenario 1 (Tutorial): tanpa drift/auditor (hasil terskrip). Skenario 2 & 3:
observer drift (Lapisan 2) + AI Auditor (Lapisan 3). Skenario 4 (RAT): dua NPC,
arsitektur "Telinga ≠ Mulut" (lihat `rat/`).

`voice` = nama suara Gemini Live (prebuilt voice), BUKAN lagi id Azure Speech.
Pilihan suara adalah USULAN — validasi dengan mendengarkan langsung.
"""

from dataclasses import dataclass, field

from prompts.keanggotaan_fiktif import KEANGGOTAAN_FIKTIF_PROMPT
from prompts.kredit_macet import KREDIT_MACET_PROMPT
from prompts.rat_darma import RAT_DARMA_PROMPT
from prompts.rat_sri import RAT_SRI_PROMPT
from prompts.tutorial import TUTORIAL_PROMPT


@dataclass(frozen=True)
class ScenarioResult:
    """Hasil terskrip (bentuk `AuditorResult` di FE) — hanya untuk tutorial."""

    ending_type: str
    narrative_feedback: str


@dataclass(frozen=True)
class DriftSpec:
    """Konfigurasi observer drift (PRD §6 Lapisan 2)."""

    dimension: str  # deskripsi arah "menyimpang" yang dinilai observer
    level1_streak: int  # giliran menyimpang berturut → Level 1 (bias longgar)
    level2_streak: int  # → Level 2 (force quit)


@dataclass(frozen=True)
class IcaValue:
    """Satu nilai koperasi ICA (Statement on the Cooperative Identity, 1995)."""

    key: str
    label: str
    description: str  # makna umum; indikator khusus skenario ada di AuditorSpec.values


# 6 nilai dasar + 4 nilai etis ICA. Skenario hanya menilai nilai yang RELEVAN baginya.
ICA_VALUES: dict[str, IcaValue] = {
    v.key: v
    for v in (
        IcaValue("swadaya", "Swadaya", "Anggota mengatasi masalahnya bersama lewat koperasi."),
        IcaValue(
            "tanggung_jawab_pribadi",
            "Tanggung Jawab Pribadi",
            "Setiap anggota memikul kewajibannya sendiri terhadap koperasi.",
        ),
        IcaValue("demokrasi", "Demokrasi", "Anggota mengendalikan koperasi dan memutuskan bersama."),
        IcaValue(
            "kesetaraan",
            "Kesetaraan",
            "Hak setiap anggota sama — satu anggota satu suara, berapa pun modalnya.",
        ),
        IcaValue(
            "keadilan",
            "Keadilan",
            "Perlakuan dan pembagian manfaat yang adil bagi setiap anggota sesuai jasanya.",
        ),
        IcaValue("solidaritas", "Solidaritas", "Anggota saling menopang demi kepentingan bersama."),
        IcaValue("kejujuran", "Kejujuran", "Bersikap dan mencatat apa adanya, tanpa menutupi."),
        IcaValue("keterbukaan", "Keterbukaan", "Transparan kepada anggota soal informasi dan keputusan."),
        IcaValue(
            "tanggung_jawab_sosial",
            "Tanggung Jawab Sosial",
            "Memperhatikan dampak koperasi bagi masyarakat sekitar.",
        ),
        IcaValue(
            "kepedulian",
            "Kepedulian terhadap Sesama",
            "Memperhatikan kesulitan dan menjaga martabat orang lain.",
        ),
    )
}


@dataclass(frozen=True)
class ValueCap:
    """Jangkar konsistensi: bila `state` auditor = `state_value`, status nilai `value`
    tak boleh melebihi `max_status` (label nilai tak pernah bertentangan dengan state)."""

    state: str
    state_value: str
    value: str  # key ICA_VALUES yang dinilai skenario ini
    max_status: str = "DIABAIKAN"


@dataclass(frozen=True)
class AuditorSpec:
    """Konfigurasi AI Auditor (PRD §6 Lapisan 3)."""

    taxonomy: dict[str, tuple[str, ...]]  # State_X → nilai yang mungkin
    grounding: str  # regulasi terkait untuk prompt auditor
    style_anchor: str  # contoh gaya & nada narasi (few-shot)
    score_keys: tuple[str, ...]  # dimensi skor 0–100
    # Nilai ICA yang RELEVAN (key ICA_VALUES → indikator perilaku di skenario ini). Tiap
    # indikator berjangkar ke state/skor/grounding di atas — bukan penilaian lepas.
    values: dict[str, str] = field(default_factory=dict)
    value_caps: tuple[ValueCap, ...] = ()


@dataclass(frozen=True)
class Persona:
    """Satu NPC dalam skenario multi-persona (RAT)."""

    key: str
    name: str
    voice: str  # nama suara Gemini Live
    prompt: str  # dibaca NPC (instruksi persona)
    identity: str  # identity participant LiveKit (satu participant per NPC)
    # Dibaca DIREKTUR (bukan NPC): posisi, sikap, dan pemicu persona ini di rapat —
    # dasar memilih siapa yang paling "tersentuh" oleh ucapan pimpinan.
    domain: str


@dataclass(frozen=True)
class RatPhase:
    """Satu fase agenda RAT (PRD §7.4)."""

    id: int
    label: str
    advance_action_label: str | None  # label tombol → fase berikutnya; None di fase akhir
    default_persona: str  # pemimpin fase: fallback direktur bila ragu (key)
    entry_line: tuple[str, str] | None = None  # (persona_key, teks) auto saat masuk fase


@dataclass(frozen=True)
class RatSpec:
    """Konfigurasi khusus RAT — dua NPC + state machine fase."""

    personas: tuple[Persona, ...]
    name_mentions: dict[str, str]  # keyword (lowercase) → persona key
    phases: tuple[RatPhase, ...]

    def persona(self, key: str) -> Persona:
        for p in self.personas:
            if p.key == key:
                return p
        raise KeyError(key)


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    npc_name: str
    voice: str  # suara Gemini Live (persona utama; RAT pakai rat.personas)
    prompt: str
    greeting_instructions: str
    mentor_brief: str = ""  # grounding fitur Petunjuk (mentor.py); tujuan + langkah
    drift: DriftSpec | None = None  # None → tanpa observer (tutorial)
    auditor: AuditorSpec | None = None  # None → hasil terskrip (tutorial)
    scripted_result: ScenarioResult | None = None
    rat: RatSpec | None = None  # None → single-NPC; ada → alur dua-NPC + fase
    # Deskripsi function-tool "tujuan tercapai" (single-NPC saja). None → tak ada
    # sinyal goal; agent tak diberi tool. Bila ada, agent memanggilnya saat tujuan
    # terpenuhi → publish attribute `goal_reached` (FE membuka tombol akhiri).
    goal_tool_prompt: str | None = None


# --- Skenario 1 — Tutorial (tanpa drift/auditor) ---------------------------

TUTORIAL = Scenario(
    scenario_id="tutorial-koperasi-konsumen",
    npc_name="Ibu Rumah Tangga",
    voice="Aoede",
    prompt=TUTORIAL_PROMPT,
    greeting_instructions=(
        "Sebagai ibu rumah tangga non-anggota, buka dengan menyapa petugas "
        "kasir sambil membawa sebotol minyak goreng untuk dibayar, lalu "
        "tanyakan harganya atau soal belanja lebih murah di koperasi. Ringkas "
        "dan ramah."
    ),
    mentor_brief=(
        "Kamu petugas kasir koperasi konsumen. Seorang ibu non-anggota datang "
        "membeli minyak goreng (harga umum ~Rp65.000). Tujuanmu: tawarkan "
        "keanggotaan dengan menjelaskan manfaatnya, lalu tuntaskan pendaftaran "
        "lewat tombol 'Bayar & Daftar'. Poin yang perlu dijelaskan: harga anggota "
        "lebih murah (~Rp58.000), Sisa Hasil Usaha (SHU) akhir tahun yang "
        "sebanding dengan belanja, serta Simpanan Pokok (dibayar sekali di awal, "
        "tetap jadi milik anggota) dan Simpanan Wajib (berkala). Alur yang baik: "
        "sapa & layani transaksinya → jelaskan untungnya jadi anggota → jelaskan "
        "Simpanan Pokok/SHU dengan sabar → ajak ibu mendaftar → tekan 'Bayar & "
        "Daftar' begitu ia setuju."
    ),
    scripted_result=ScenarioResult(
        ending_type="good",
        narrative_feedback=(
            "Selamat! Kamu berhasil menyelesaikan sesi tutorial. Kamu telah "
            "mempelajari fungsi dasar koperasi konsumen sebagai penyedia "
            "kebutuhan harian, keuntungan menjadi anggota (diskon harga + SHU), "
            "serta prinsip keanggotaan yang bersifat terbuka bagi masyarakat."
        ),
    ),
    goal_tool_prompt=(
        "Tandai bahwa tujuan tutorial tercapai. Panggil fungsi ini TEPAT SATU "
        "KALI, hanya pada saat ibu (pelanggan) sudah jelas-jelas MENYATAKAN "
        "SETUJU menjadi anggota koperasi — yakni setuju mendaftar sekaligus "
        "membayar Simpanan Pokok. JANGAN panggil bila ia masih bertanya, ragu, "
        "atau baru tertarik; hanya setelah persetujuan tegas."
    ),
)


# --- Skenario 2 — Kredit Macet ---------------------------------------------

KREDIT_MACET = Scenario(
    scenario_id="kredit-macet",
    npc_name="Pak Joko",
    voice="Puck",
    prompt=KREDIT_MACET_PROMPT,
    greeting_instructions=(
        "Buka sebagai Joko dengan nada cemas dan sedikit defensif: akui cicilan "
        "menunggak sekitar dua bulan dan tegaskan tidak berniat lari dari "
        "kewajiban, tanpa langsung merinci semua sebabnya. Jangan memanggil "
        "petugas dengan 'Pak/Bu'. Ringkas."
    ),
    mentor_brief=(
        "Kamu petugas koperasi simpan pinjam menghadapi Pak Joko yang menunggak "
        "cicilan sekitar dua bulan. Semua berlangsung LEWAT PERCAKAPAN saja — tidak "
        "ada kontak fisik, foto, atau tukar dokumen di tempat. Tujuanmu: pahami "
        "sebab tunggakan lewat pertanyaan yang empatik dan objektif, lalu arahkan "
        "ke penyelesaian yang menjaga martabat anggota. Alur percakapan yang baik: "
        "tanyakan kabar usahanya dan apa yang membuatnya kesulitan; dengarkan "
        "ceritanya (akses jalan tertutup proyek, omzet anjlok); tunjukkan "
        "pengertian; lalu TAWARKAN keringanan konkret — menjadwalkan ulang "
        "angsuran, menurunkan cicilan sementara, atau memberi tenggang sampai "
        "usahanya pulih (langkah ini dikenal sebagai restrukturisasi). Bila merasa "
        "perlu bukti, CUKUP sepakati untuk menjadwalkan pemeriksaan catatan nanti — "
        "jangan menuntut dokumen diserahkan saat ini. Hindari ancaman atau "
        "penyitaan sepihak; nada mengancam menaikkan ketegangan dan membuat Pak "
        "Joko menutup diri."
    ),
    drift=DriftSpec(
        dimension=(
            "Petugas cenderung MELANGGAR PROSEDUR: mengancam, mengintimidasi, "
            "menyita sepihak, mempermalukan, atau kaku tanpa mencari solusi "
            "kekeluargaan terhadap Pak Joko. Perilaku investigatif yang sah "
            "(bertanya kritis soal sebab tunggakan) BUKAN penyimpangan."
        ),
        level1_streak=2,
        level2_streak=4,
    ),
    auditor=AuditorSpec(
        taxonomy={
            "State_Analisis_Masalah": ("BENAR", "SALAH"),
            "State_Jalur_Remedi": ("SESUAI", "MELANGGAR_PROSEDUR", "NAIF"),
        },
        grounding=(
            "Asas kekeluargaan (UU 25/1992), Permenkop No. 8/2023, dan mekanisme "
            "3R (Rescheduling/Reconditioning/Restructuring). Penyelesaian yang "
            "baik menggali sebab tunggakan lalu menawarkan jalur 3R; penyelesaian "
            "buruk mengandalkan ancaman/penyitaan sepihak yang melangkahi prosedur."
        ),
        style_anchor=(
            "Contoh nada (good/SESUAI): 'Anda menegakkan asas kekeluargaan tanpa "
            "mengorbankan prosedur — dengan menggali sebab tunggakan lalu "
            "menawarkan jalur 3R, Pak Joko tetap kooperatif dan pinjaman berpeluang "
            "pulih.' Narasi harus konkret, merujuk perilaku pemain, dan menyebut "
            "grounding regulasi bila relevan."
        ),
        score_keys=("member_centric", "compliance", "soft_skills"),
        values={
            "kepedulian": (
                "Menggali sebab tunggakan dengan empati — memberi Pak Joko ruang bercerita "
                "(akses jalan tertutup proyek, omzet anjlok) sebelum menilai, dan menjaga "
                "martabatnya. Selaras dengan State_Analisis_Masalah & skor member_centric."
            ),
            "keadilan": (
                "Menawarkan jalan keluar yang adil sesuai prosedur (3R: jadwal ulang, "
                "keringanan syarat, atau penataan ulang) tanpa ancaman, intimidasi, atau "
                "penyitaan sepihak. Selaras dengan State_Jalur_Remedi (SESUAI vs "
                "MELANGGAR_PROSEDUR)."
            ),
            "tanggung_jawab_pribadi": (
                "Keringanan tetap disertai komitmen Pak Joko memenuhi kewajibannya; tidak "
                "membebaskan utang tanpa dasar. Selaras dengan State_Jalur_Remedi (SESUAI "
                "vs NAIF)."
            ),
        },
        value_caps=(
            ValueCap("State_Jalur_Remedi", "MELANGGAR_PROSEDUR", "keadilan"),
            ValueCap("State_Jalur_Remedi", "NAIF", "tanggung_jawab_pribadi"),
        ),
    ),
)


# --- Skenario 3 — Keanggotaan Fiktif ---------------------------------------

KEANGGOTAAN_FIKTIF = Scenario(
    scenario_id="keanggotaan-fiktif",
    npc_name="Pak Bambang",
    voice="Charon",
    prompt=KEANGGOTAAN_FIKTIF_PROMPT,
    greeting_instructions=(
        "Buka sebagai Bambang: sambut petugas dengan ramah, persilakan memeriksa "
        "catatan, dan siratkan kamu sudah puluhan tahun memegang pembukuan "
        "koperasi. Jangan memanggil petugas dengan 'Pak/Bu'. Ringkas."
    ),
    mentor_brief=(
        "Kamu pengawas/pengurus baru yang mengaudit Daftar Anggota dan menemukan "
        "kejanggalan bersama Pak Bambang, Bendahara Senior yang dihormati. Semua "
        "lewat PERCAKAPAN saja. Kamu SUDAH punya satu dokumen: cuplikan Daftar "
        "Anggota lewat tombol 'Periksa Dokumen' (ada nomor anggota ganda KOP-0161, "
        "baris tanpa NIK/alamat, dan baris tanpa Simpanan Pokok). Cukup pakai "
        "dokumen itu — jangan menyuruh pemain mencari berkas lain yang tidak ada. "
        "Tujuanmu: bereskan data fiktif TANPA merusak hubungan. Arahkan pemain ke "
        "langkah solutif dan ramah: sebut satu kejanggalan konkret dari dokumen "
        "dengan sopan, tanyakan baik-baik latar belakangnya, jelaskan sederhana "
        "bahwa data yang tidak jelas bisa mengurangi hak bonus (SHU) anggota yang "
        "benar-benar aktif, lalu ajak menyepakati langkah membereskannya bersama "
        "(mis. merencanakan pencocokan ulang ke ketua RT/dusun untuk nanti). "
        "Hindari menuduh memalsukan data atau mengancam pidana, dan jangan pula "
        "membiarkan data demi sungkan."
    ),
    drift=DriftSpec(
        dimension=(
            "Petugas cenderung MERUSAK RELASI: menuduh tanpa bukti, menyebut "
            "Pak Bambang pencuri/korupsi, mengancam memecat/melapor, bersikap "
            "represif. Verifikasi berbasis data dan klarifikasi yang sah BUKAN "
            "penyimpangan."
        ),
        level1_streak=2,
        level2_streak=4,
    ),
    auditor=AuditorSpec(
        taxonomy={
            "State_Verifikasi_Data": ("DIBERSIHKAN", "DIBIARKAN"),
            "State_Relasi_NPC": ("TERJAGA", "RUSAK"),
        },
        grounding=(
            "UU 25/1992 Pasal 17(2) & Pasal 30(1)(f) tentang keabsahan "
            "keanggotaan, serta dampak dilusi SHU anggota riil (Pasal 5(1)(c)). "
            "Penanganan baik membersihkan data lewat verifikasi sambil menjaga "
            "relasi; penanganan buruk menuduh tanpa bukti dan merusak hubungan "
            "kerja, atau membiarkan data fiktif."
        ),
        style_anchor=(
            "Contoh nada (good/DIBERSIHKAN+TERJAGA): 'Data anggota fiktif berhasil "
            "dibersihkan tanpa merusak hubungan dengan Pak Bambang — Anda "
            "menempatkan verifikasi di atas tuduhan, melindungi SHU anggota riil.' "
            "Narasi harus konkret, merujuk perilaku pemain, dan menyebut grounding "
            "regulasi bila relevan."
        ),
        score_keys=("integritas_data", "compliance", "soft_skills"),
        values={
            "kejujuran": (
                "Menyebut kejanggalan Daftar Anggota apa adanya (nomor ganda, baris tanpa "
                "NIK/alamat, tanpa Simpanan Pokok) dan tidak membiarkan data fiktif karena "
                "sungkan. Selaras dengan State_Verifikasi_Data & skor integritas_data."
            ),
            "keadilan": (
                "Mengaitkan pembersihan data dengan hak SHU dan hak suara anggota asli yang "
                "terdilusi nama fiktif. Selaras dengan grounding Pasal 5(1)(c) & "
                "State_Verifikasi_Data."
            ),
            "kepedulian": (
                "Menjaga kehormatan dan relasi dengan Pak Bambang — mengklarifikasi baik-baik, "
                "bukan menuduh, mempermalukan, atau mengancam. Selaras dengan "
                "State_Relasi_NPC & skor soft_skills."
            ),
        },
        value_caps=(ValueCap("State_Relasi_NPC", "RUSAK", "kepedulian"),),
    ),
)


# --- Skenario 4 — Rapat Anggota Tahunan (RAT), dua NPC + fase ---------------

RAPAT_ANGGOTA_TAHUNAN = Scenario(
    scenario_id="rapat-anggota-tahunan",
    npc_name="Pak Darma & Ibu Sri",
    voice="Aoede",  # tak dipakai langsung; lihat rat.personas
    prompt=RAT_SRI_PROMPT,  # tak dipakai langsung; tiap NPC memakai Persona.prompt
    greeting_instructions=(
        "Sebagai Sri, sambut pimpinan rapat dengan santun: sampaikan anggota kecil "
        "sudah hadir dan berharap suara mereka didengar, lalu selipkan dorongan "
        "halus agar rapat segera dibuka setelah kuorum dipastikan. Sapa dengan "
        "'Pimpinan', jangan 'Pak/Bu'. Ringkas."
    ),
    mentor_brief=(
        "Kamu Ketua Rapat yang memimpin Rapat Anggota Tahunan (RAT), semua lewat "
        "percakapan. Rapat punya tiga tahap dan pemain memajukannya lewat tombol "
        "aksi: (1) Buka Rapat — periksa daftar hadir, pastikan kuorum (4 anggota, "
        "3 hadir), lalu buka rapat; (2) Baca LPJ — bacakan rencana kerja (beli "
        "beras lokal); di sini Pak Darma menyela kasar dan mengancam menarik "
        "modalnya karena ingin dana dialihkan ke properti pribadinya, sementara "
        "Ibu Sri membela anggota kecil; (3) Ambil Keputusan — pakai Tata Tertib "
        "(satu anggota satu suara) lalu selesaikan lewat musyawarah/voting yang "
        "adil. Tujuanmu: rapat TUNTAS secara demokratis — tidak tunduk pada tekanan "
        "modal, tapi juga tidak menyerang pribadi hingga rapat bubar. Arahkan "
        "pemain ke langkah berikutnya sesuai tahap yang sedang berjalan, dorong "
        "maju bila ia tampak berputar, dan ingatkan ia bisa memanggil nama Pak "
        "Darma atau Ibu Sri untuk berbicara ke salah satunya. Konflik modal vs "
        "suara kecil itu memang inti skenario — bantu pemain menyelesaikannya "
        "secara prosedural, bukan menghindarinya."
    ),
    drift=DriftSpec(
        dimension=(
            "Pimpinan membiarkan RAPAT MENUJU BUBAR: eskalasi konflik/konfrontasi "
            "dengan anggota (terutama Pak Darma) tanpa penyelesaian prosedural — "
            "membiarkan forum kacau, saling menyela tak terkendali, atau menekan "
            "balik secara kasar. Menegakkan tata tertib/musyawarah/voting yang "
            "adil BUKAN penyimpangan."
        ),
        level1_streak=2,
        level2_streak=4,
    ),
    auditor=AuditorSpec(
        taxonomy={
            "State_Proses_Rapat": ("TUNTAS", "BUBAR"),
            "State_Keabsahan_Keputusan": (
                "SAH_DEMOKRATIS",
                "TUNDUK_TEKANAN_MODAL",
                "TIDAK_BERLAKU",
            ),
        },
        grounding=(
            "UU 25/1992 Pasal 22(1) & Pasal 23 tentang kewenangan Rapat Anggota, "
            "Pasal 5(1)(b) & (d) tentang prinsip demokrasi & satu anggota satu "
            "suara, serta Permenkop No. 19/PER/M.KUKM/IX/2015. Rapat yang bubar "
            "tanpa penyelesaian prosedural membuat keputusan tidak berlaku; "
            "keputusan yang tunduk pada tekanan modal melanggar asas demokrasi."
        ),
        style_anchor=(
            "Contoh nada (good/TUNTAS+SAH_DEMOKRATIS): 'Rapat berjalan tuntas dan "
            "keputusan diambil demokratis — Anda menegakkan satu anggota satu "
            "suara sehingga tekanan modal Pak Darma tidak menyandera forum.' "
            "Narasi harus konkret, merujuk perilaku pemain, dan menyebut grounding "
            "regulasi bila relevan."
        ),
        score_keys=("kepemimpinan", "compliance", "soft_skills"),
        values={
            "demokrasi": (
                "Membawa perbedaan pendapat ke musyawarah/voting sesuai Tata Tertib hingga "
                "rapat tuntas dan keputusan diambil oleh forum. Selaras dengan "
                "State_Keabsahan_Keputusan & State_Proses_Rapat."
            ),
            "kesetaraan": (
                "Menegakkan satu anggota satu suara — besar modal Pak Darma tidak membeli "
                "suara atau arah kebijakan. Selaras dengan State_Keabsahan_Keputusan (vs "
                "TUNDUK_TEKANAN_MODAL)."
            ),
            "kepedulian": (
                "Menghadapi interupsi Pak Darma dengan tegas tapi santun, tanpa menyerang "
                "pribadinya, sambil menenangkan forum. Selaras dengan State_Proses_Rapat & "
                "skor soft_skills."
            ),
        },
        value_caps=(
            ValueCap("State_Proses_Rapat", "BUBAR", "demokrasi"),
            ValueCap("State_Keabsahan_Keputusan", "TUNDUK_TEKANAN_MODAL", "demokrasi"),
            ValueCap("State_Keabsahan_Keputusan", "TUNDUK_TEKANAN_MODAL", "kesetaraan"),
        ),
    ),
    rat=RatSpec(
        personas=(
            Persona(
                key="darma",
                name="Pak Darma",
                voice="Orus",
                prompt=RAT_DARMA_PROMPT,
                identity="npc-pak-darma",
                domain=(
                    "penyetor modal terbesar; ingin dana koperasi dialihkan ke properti "
                    "pribadinya dan mengancam menarik modal. Tersentuh bila pimpinan "
                    "membahas modal, rencana kerja/anggaran, penolakan usulannya, "
                    "tata tertib yang membatasi pengaruh modal, atau bila ia ditegur."
                ),
            ),
            Persona(
                key="sri",
                name="Ibu Sri",
                voice="Aoede",
                prompt=RAT_SRI_PROMPT,
                identity="npc-ibu-sri",
                domain=(
                    "wakil petani/pedagang kecil; membela 'satu anggota satu suara' dan "
                    "usulan beli beras dari kelompok tani lokal; penjaga prosedur. "
                    "Tersentuh bila pimpinan membahas kuorum, hak suara, tata tertib, "
                    "musyawarah/voting, usulan beras lokal, atau nasib anggota kecil."
                ),
            ),
        ),
        name_mentions={"darma": "darma", "sri": "sri"},
        phases=(
            RatPhase(
                id=1,
                label="Buka Rapat",
                advance_action_label="Baca LPJ",
                default_persona="sri",
            ),
            RatPhase(
                id=2,
                label="Baca LPJ",
                advance_action_label="Ambil Keputusan",
                default_persona="darma",
                entry_line=(
                    "darma",
                    ("Interupsi! Laporan ini omong kosong. Modal terbesar di "
                    "koperasi ini dari saya, jadi arah kebijakan harus ikut saya. "
                    "Jangan buang waktu dengan keluhan pedagang kecil!"),
                ),
            ),
            RatPhase(
                id=3,
                label="Ambil Keputusan",
                advance_action_label=None,
                default_persona="sri",
            ),
        ),
    ),
)


_SCENARIOS: dict[str, Scenario] = {
    TUTORIAL.scenario_id: TUTORIAL,
    KREDIT_MACET.scenario_id: KREDIT_MACET,
    KEANGGOTAAN_FIKTIF.scenario_id: KEANGGOTAAN_FIKTIF,
    RAPAT_ANGGOTA_TAHUNAN.scenario_id: RAPAT_ANGGOTA_TAHUNAN,
}


def get_scenario(scenario_id: str) -> Scenario:
    scenario = _SCENARIOS.get(scenario_id)
    if scenario is None:
        raise ValueError(f"Skenario belum didukung backend: {scenario_id!r}")
    return scenario
