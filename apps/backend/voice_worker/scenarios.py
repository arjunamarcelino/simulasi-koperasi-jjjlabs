"""Registry skenario → persona/voice + spesifikasi drift & auditor.

Skenario 1 (Tutorial): tanpa drift/auditor (hasil terskrip). Skenario 2 & 3:
observer drift (Lapisan 2) + AI Auditor (Lapisan 3). Skenario 4 (RAT) menyusul.
"""

from dataclasses import dataclass

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
class AuditorSpec:
    """Konfigurasi AI Auditor (PRD §6 Lapisan 3)."""

    taxonomy: dict[str, tuple[str, ...]]  # State_X → nilai yang mungkin
    grounding: str  # regulasi terkait untuk prompt auditor
    style_anchor: str  # contoh gaya & nada narasi (few-shot)
    score_keys: tuple[str, ...]  # dimensi skor 0–100


@dataclass(frozen=True)
class Persona:
    """Satu NPC dalam skenario multi-persona (RAT)."""

    key: str
    name: str
    voice: str  # Azure Speech voice id
    prompt: str


@dataclass(frozen=True)
class RatPhase:
    """Satu fase agenda RAT (PRD §7.4)."""

    id: int
    label: str
    advance_action_label: str | None  # label tombol → fase berikutnya; None di fase akhir
    default_persona: str  # responder default fase ini (key)
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
    voice: str  # Azure Speech voice id (persona utama; RAT pakai rat.personas)
    prompt: str
    greeting_instructions: str
    drift: DriftSpec | None = None  # None → tanpa observer (tutorial)
    auditor: AuditorSpec | None = None  # None → hasil terskrip (tutorial)
    scripted_result: ScenarioResult | None = None
    rat: RatSpec | None = None  # None → single-NPC; ada → alur dua-NPC + fase


# --- Skenario 1 — Tutorial (tanpa drift/auditor) ---------------------------

TUTORIAL = Scenario(
    scenario_id="tutorial-koperasi-konsumen",
    npc_name="Ibu Rumah Tangga",
    voice="id-ID-GadisNeural",
    prompt=TUTORIAL_PROMPT,
    greeting_instructions=(
        "Sapa petugas koperasi sebagai ibu rumah tangga yang penasaran soal "
        "belanja lebih murah di koperasi. Ringkas dan ramah."
    ),
    scripted_result=ScenarioResult(
        ending_type="good",
        narrative_feedback=(
            "Selamat! Ibu tadi resmi terdaftar sebagai anggota dan telah "
            "membayar Simpanan Pokok. Anda baru saja menuntaskan transaksi "
            "koperasi konsumen pertama Anda — mendaftar, menyimpan, lalu "
            "menikmati manfaat sebagai anggota."
        ),
    ),
)


# --- Skenario 2 — Kredit Macet ---------------------------------------------

KREDIT_MACET = Scenario(
    scenario_id="kredit-macet",
    npc_name="Pak Joko",
    voice="id-ID-ArdiNeural",
    prompt=KREDIT_MACET_PROMPT,
    greeting_instructions=(
        "Buka sebagai Pak Joko: akui cicilan menunggak, jelaskan singkat "
        "warung sepi, tegaskan tidak berniat lari dari kewajiban."
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
    ),
)


# --- Skenario 3 — Keanggotaan Fiktif ---------------------------------------

KEANGGOTAAN_FIKTIF = Scenario(
    scenario_id="keanggotaan-fiktif",
    npc_name="Pak Bambang",
    voice="id-ID-ArdiNeural",
    prompt=KEANGGOTAAN_FIKTIF_PROMPT,
    greeting_instructions=(
        "Buka sebagai Pak Bambang: sambut petugas, persilakan memeriksa, "
        "siratkan sudah puluhan tahun memegang pembukuan koperasi."
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
    ),
)


# --- Skenario 4 — Rapat Anggota Tahunan (RAT), dua NPC + fase ---------------

RAPAT_ANGGOTA_TAHUNAN = Scenario(
    scenario_id="rapat-anggota-tahunan",
    npc_name="Pak Darma & Ibu Sri",
    voice="id-ID-GadisNeural",  # tak dipakai langsung; lihat rat.personas
    prompt=RAT_SRI_PROMPT,  # placeholder; llm_node menukar per persona aktif
    greeting_instructions=(
        "Sebagai Ibu Sri, sambut pimpinan rapat: sampaikan anggota kecil sudah "
        "hadir dan berharap suara mereka didengar. Ringkas dan santun."
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
    ),
    rat=RatSpec(
        personas=(
            Persona(
                key="darma",
                name="Pak Darma",
                voice="id-ID-ArdiNeural",
                prompt=RAT_DARMA_PROMPT,
            ),
            Persona(
                key="sri",
                name="Ibu Sri",
                voice="id-ID-GadisNeural",
                prompt=RAT_SRI_PROMPT,
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
                    "Interupsi! Laporan ini omong kosong. Modal terbesar di "
                    "koperasi ini dari saya, jadi arah kebijakan harus ikut saya. "
                    "Jangan buang waktu dengan keluhan pedagang kecil!",
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
