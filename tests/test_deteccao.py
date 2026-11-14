"""Testes das regras de detecção com contagens FIXTURE_ (não são dados reais)."""
from src.indicators.deteccao import ESTADO, detectar, montar_contagens, trimestres_anteriores, trimestres_entre, wilson

FIXTURE_T = "FIXTURE_mun"


def test_trimestres_anteriores():
    assert trimestres_anteriores("2025T1", 2) == ["2024T4", "2024T3"]


def test_wilson_limites():
    lo, hi = wilson(5, 10)
    assert 0.2 < lo < 0.5 < hi < 0.8


def test_r1_linhagem_nova():
    c = {(FIXTURE_T, "2024T4"): {"FIXTURE_A": 12}, (FIXTURE_T, "2025T1"): {"FIXTURE_A": 8, "FIXTURE_B": 2}}
    regras = {a.regra for a in detectar(c, {}, FIXTURE_T, "2025T1")}
    assert "R1_linhagem_nova" in regras


def test_r2_exige_minimo():
    c = {(FIXTURE_T, "2024T4"): {"FIXTURE_A": 9, "FIXTURE_B": 1}, (FIXTURE_T, "2025T1"): {"FIXTURE_B": 5}}
    assert not [a for a in detectar(c, {}, FIXTURE_T, "2025T1") if a.regra == "R2_crescimento_proporcao"]


def test_r3_queda_cobertura():
    cob = {(FIXTURE_T, p): 0.02 for p in trimestres_anteriores("2025T1", 8)}
    cob[(FIXTURE_T, "2025T1")] = 0.005
    assert [a for a in detectar({}, cob, FIXTURE_T, "2025T1") if a.regra == "R3_queda_cobertura"]


def test_montar_contagens_soma_municipio_e_estado():
    linhas = [(9999999, "2025T1", "FIXTURE_A"), (None, "2025T1", "FIXTURE_A"), (9999999, "2025T1", "FIXTURE_B")]
    c = montar_contagens(linhas)
    assert c[("9999999", "2025T1")] == {"FIXTURE_A": 1, "FIXTURE_B": 1}
    assert c[(ESTADO, "2025T1")] == {"FIXTURE_A": 2, "FIXTURE_B": 1}


def test_trimestres_entre():
    assert trimestres_entre("2024T3", "2025T2") == ["2024T3", "2024T4", "2025T1", "2025T2"]
