"""SIM-21: integritas registry skenario + guard kontrak lintas-proses.

Guard struktural (bukan parse CONTRACT.md). Nilai utamanya: cross-check antara
dua set scenario_id yang di-duplikasi tangan di DUA proses terpisah
(`voice_worker/scenarios.py` vs `api/server.py`) — satu-satunya tempat keduanya
hidup di interpreter yang sama. Semua test ini sinkron (data murni, tanpa LLM).
"""

from __future__ import annotations

import pytest
from scenarios import _SCENARIOS, ICA_VALUES, get_scenario
from schemas import VALUE_STATUSES


def test_registry_keys_match_scenario_id():
    # Penangkap copy-paste: key dict harus sama dengan atribut scenario_id.
    for key, scenario in _SCENARIOS.items():
        assert key == scenario.scenario_id


def test_valid_scenarios_matches_registry_cross_process():
    # Guard kontrak (done-when #3): set gerbang /token (server) == registry worker.
    from api import server

    assert set(server.VALID_SCENARIOS) == set(_SCENARIOS)


def test_get_scenario_resolves_known_and_rejects_unknown():
    # Sapuan id==key penuh ada di test_registry_keys_match_scenario_id; di sini cukup
    # satu resolusi representatif + penolakan id tak dikenal (ValueError).
    some_key = next(iter(_SCENARIOS))
    assert get_scenario(some_key).scenario_id == some_key
    with pytest.raises(ValueError):
        get_scenario("skenario-tak-ada")


def test_scripted_xor_auditor():
    # Biconditional: tepat skenario tanpa auditor yang pakai scripted_result.
    # Skenario tanpa keduanya akan men-trip `assert spec is not None` di run_auditor.
    for scenario in _SCENARIOS.values():
        assert (scenario.auditor is None) == (scenario.scripted_result is not None)


def test_auditor_specs_are_non_empty():
    # Hanya skenario ber-auditor (tutorial di-skip: auditor=None).
    audited = [s for s in _SCENARIOS.values() if s.auditor is not None]
    assert audited  # fail-loud: minimal satu skenario ber-auditor harus ada
    for scenario in audited:
        spec = scenario.auditor
        # Fail-loud guard (SIM-20): file yang di-reformat tak boleh lolos hijau-kosong.
        assert len(spec.score_keys) > 0
        assert len(spec.taxonomy) > 0
        for state, values in spec.taxonomy.items():
            assert len(values) > 0, f"state {state} tanpa nilai"


def test_rat_persona_references_resolve():
    rat = get_scenario("rapat-anggota-tahunan").rat
    assert rat is not None
    persona_keys = {p.key for p in rat.personas}
    assert persona_keys  # fail-loud

    # Setiap key yang dirujuk harus menyelesaikan ke persona yang ada.
    for key in rat.name_mentions.values():
        assert rat.persona(key).key == key
    for phase in rat.phases:
        assert phase.default_persona in persona_keys
        if phase.entry_line is not None:
            assert phase.entry_line[0] in persona_keys


def test_ica_registry_is_complete_and_self_keyed():
    # 10 nilai ICA (Statement on the Cooperative Identity): 6 nilai dasar + 4 nilai etis.
    assert len(ICA_VALUES) == 10
    for key, value in ICA_VALUES.items():
        assert key == value.key
        assert value.label and value.description


def test_auditor_values_are_relevant_ica_values():
    audited = [s for s in _SCENARIOS.values() if s.auditor is not None]
    assert audited  # fail-loud
    for scenario in audited:
        spec = scenario.auditor
        # Hanya nilai yang relevan (bukan semua); batas atas menjaga ukuran riwayat /token.
        assert 0 < len(spec.values) <= 4, scenario.scenario_id
        for key, indicator in spec.values.items():
            assert key in ICA_VALUES, f"{scenario.scenario_id}: nilai {key} bukan nilai ICA"
            assert indicator.strip(), f"{scenario.scenario_id}: indikator {key} kosong"


def test_value_caps_reference_existing_states_and_values():
    # Cap menjangkarkan nilai ke taksonomi auditor: state & nilai state harus ADA,
    # dan nilai ICA yang dibatasi harus dinilai di skenario itu.
    for scenario in _SCENARIOS.values():
        spec = scenario.auditor
        if spec is None:
            continue
        for cap in spec.value_caps:
            assert cap.state in spec.taxonomy, f"{scenario.scenario_id}: {cap.state}"
            assert cap.state_value in spec.taxonomy[cap.state], cap
            assert cap.value in spec.values, cap
            assert cap.max_status in VALUE_STATUSES, cap
