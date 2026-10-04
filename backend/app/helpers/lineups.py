from __future__ import annotations

"""Aggregate possession-level data into lineup-level metrics for the analytics UI.

The backend keeps separate offensive and defensive accumulators for each team and
lineup combination so the frontend can sort and compare units by efficiency,
rebounding, and possession quality without re-reading raw event logs.
"""

from collections import defaultdict
import itertools
from typing import Any

from app.models import Player, Possession, Team

LineupRecord = dict[str, Any]

STAT_FIELDS = [
    "points",
    "shot_attempts",
    "fg2_made",
    "fg2_attempted",
    "fg3_made",
    "fg3_attempted",
    "fg_made",
    "fg_attempted",
    "ft_made",
    "ft_attempted",
    "rebounds_offense",
    "rebounds_defense",
    "rebound_opportunities",
    "assists",
    "steals",
    "turnovers",
    "blocks",
    "offensive_fouls",
    "defensive_fouls",
    "shooting_fouls",
    "shot_attempt_points",
    "ft_potential_points",
    "transition_take_fouls",
]

INDEX_MAP = {name: idx for idx, name in enumerate(STAT_FIELDS)}


def _normalize_lineup_size(lineup_size: Any) -> int:
    try:
        normalized_lineup_size = int(lineup_size)
    except (TypeError, ValueError):
        return 5
    return max(1, min(5, normalized_lineup_size))


def _safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    return (numerator / denominator) if denominator > 0 else default


def get_lineup_league_summary_stats(
    lineup_size: int = 5,
    min_possessions: int = 0,
    team_id: str | None = None,
    sort_by: str = "total_possessions",
) -> list[LineupRecord]:
    n = _normalize_lineup_size(lineup_size)

    players_by_id = {str(p.id): p.name for p in Player.objects.all()}
    teams_by_id = {str(t.id): t.name for t in Team.objects.all()}

    num_fields = len(STAT_FIELDS)
    off_acc: dict[tuple[str, tuple[str, ...]], list[int]] = defaultdict(
        lambda: [0] * (num_fields + 1)
    )
    def_acc: dict[tuple[str, tuple[str, ...]], list[int]] = defaultdict(
        lambda: [0] * (num_fields + 1)
    )

    possessions = Possession.objects.values_list(
        "offensive_team_id",
        "defensive_team_id",
        "offensive_player_ids",
        "defensive_player_ids",
        *STAT_FIELDS,
    ).iterator(chunk_size=2000)

    for row in possessions:
        off_team = str(row[0])
        def_team = str(row[1])
        off_pids = [str(pid) for pid in row[2]]
        def_pids = [str(pid) for pid in row[3]]
        stat_values = row[4:]

        # Every possession is assigned to every eligible lineup combination for the
        # offense and the defense. This preserves lineup-level context without
        # forcing the frontend to re-derive the aggregate from raw possessions.
        for combo in itertools.combinations(sorted(off_pids), n):
            target = off_acc[(off_team, combo)]
            target[0] += 1
            for i in range(num_fields):
                target[i + 1] += stat_values[i]

        for combo in itertools.combinations(sorted(def_pids), n):
            target = def_acc[(def_team, combo)]
            target[0] += 1
            for i in range(num_fields):
                target[i + 1] += stat_values[i]

    all_keys = set(off_acc.keys()).union(set(def_acc.keys()))
    results: list[LineupRecord] = []

    for t_id, combo in all_keys:
        if team_id and t_id != team_id:
            continue

        o = off_acc[(t_id, combo)]
        d = def_acc[(t_id, combo)]

        off_poss = o[0]
        def_poss = d[0]
        total_poss = off_poss + def_poss

        if total_poss < min_possessions:
            continue

        # The accumulator layout is [possession_count, stat_1, stat_2, ...].
        # Keeping the count in slot 0 allows the same helper to retrieve per-stat
        # totals by offset without additional data structures.
        def get_stat(acc_list: list[int], name: str) -> int:
            return acc_list[INDEX_MAP[name] + 1]

        o_pts = get_stat(o, "points")
        o_fga = get_stat(o, "fg_attempted")
        o_fgm = get_stat(o, "fg_made")
        o_fg2a = get_stat(o, "fg2_attempted")
        o_fg2m = get_stat(o, "fg2_made")
        o_fg3a = get_stat(o, "fg3_attempted")
        o_fg3m = get_stat(o, "fg3_made")
        o_fta = get_stat(o, "ft_attempted")
        o_ftm = get_stat(o, "ft_made")
        o_tov = get_stat(o, "turnovers")
        o_oreb = get_stat(o, "rebounds_offense")
        o_dreb = get_stat(o, "rebounds_defense")

        d_pts = get_stat(d, "points")
        d_fga = get_stat(d, "fg_attempted")
        d_fgm = get_stat(d, "fg_made")
        d_fg2a = get_stat(d, "fg2_attempted")
        d_fg2m = get_stat(d, "fg2_made")
        d_fg3a = get_stat(d, "fg3_attempted")
        d_fg3m = get_stat(d, "fg3_made")
        d_fta = get_stat(d, "ft_attempted")
        d_ftm = get_stat(d, "ft_made")
        d_tov = get_stat(d, "turnovers")
        d_oreb = get_stat(d, "rebounds_offense")
        d_dreb = get_stat(d, "rebounds_defense")

        ortg = _safe_divide(o_pts * 100.0, off_poss)
        drtg = _safe_divide(d_pts * 100.0, def_poss)
        net_rtg = ortg - drtg

        off_efg = _safe_divide(o_fgm + 0.5 * o_fg3m, o_fga)
        def_efg = _safe_divide(d_fgm + 0.5 * d_fg3m, d_fga)

        off_tov_pct = _safe_divide(o_tov * 100.0, off_poss)
        def_tov_pct = _safe_divide(d_tov * 100.0, def_poss)

        oreb_opps = get_stat(o, "rebound_opportunities")
        dreb_opps = get_stat(d, "rebound_opportunities")
        off_oreb_pct = _safe_divide(o_oreb * 100.0, oreb_opps)
        def_dreb_pct = _safe_divide(d_dreb * 100.0, dreb_opps)

        off_ftr = _safe_divide(o_fta, o_fga)
        def_ftr = _safe_divide(d_fta, d_fga)

        off_ts_pct = _safe_divide(o_pts, 2.0 * (o_fga + 0.44 * o_fta))
        off_3par = _safe_divide(o_fg3a, o_fga)

        record: LineupRecord = {
            "team_id": t_id,
            "team_name": teams_by_id.get(t_id, "Unknown Team"),
            "player_ids": list(combo),
            "players": [
                {"player_id": pid, "name": players_by_id.get(pid, "Unknown Player")}
                for pid in combo
            ],
            "offensive_rating": round(ortg, 2),
            "defensive_rating": round(drtg, 2),
            "net_rating": round(net_rtg, 2),
            "offensive_efg_pct": round(off_efg, 4),
            "offensive_tov_pct": round(off_tov_pct, 2),
            "offensive_oreb_pct": round(off_oreb_pct, 2),
            "offensive_ft_rate": round(off_ftr, 4),
            "defensive_efg_pct": round(def_efg, 4),
            "defensive_tov_pct": round(def_tov_pct, 2),
            "defensive_dreb_pct": round(def_dreb_pct, 2),
            "defensive_ft_rate": round(def_ftr, 4),
            "offensive_ts_pct": round(off_ts_pct, 4),
            "offensive_3par": round(off_3par, 4),
            "total_possessions": total_poss,
            "offensive_possessions": off_poss,
            "defensive_possessions": def_poss,
            "offensive_points": o_pts,
            "offensive_shot_attempts": get_stat(o, "shot_attempts"),
            "offensive_fg2_made": o_fg2m,
            "offensive_fg2_attempted": o_fg2a,
            "offensive_fg3_made": o_fg3m,
            "offensive_fg3_attempted": o_fg3a,
            "offensive_fg_made": o_fgm,
            "offensive_fg_attempted": o_fga,
            "offensive_ft_made": o_ftm,
            "offensive_ft_attempted": o_fta,
            "offensive_rebounds_offense": o_oreb,
            "offensive_rebounds_defense": o_dreb,
            "offensive_rebound_opportunities": oreb_opps,
            "offensive_assists": get_stat(o, "assists"),
            "offensive_steals": get_stat(o, "steals"),
            "offensive_turnovers": o_tov,
            "offensive_blocks": get_stat(o, "blocks"),
            "offensive_offensive_fouls": get_stat(o, "offensive_fouls"),
            "offensive_defensive_fouls": get_stat(o, "defensive_fouls"),
            "offensive_shooting_fouls": get_stat(o, "shooting_fouls"),
            "offensive_shot_attempt_points": get_stat(o, "shot_attempt_points"),
            "offensive_ft_potential_points": get_stat(o, "ft_potential_points"),
            "offensive_transition_take_fouls": get_stat(o, "transition_take_fouls"),
            "defensive_points": d_pts,
            "defensive_shot_attempts": get_stat(d, "shot_attempts"),
            "defensive_fg2_made": d_fg2m,
            "defensive_fg2_attempted": d_fg2a,
            "defensive_fg3_made": d_fg3m,
            "defensive_fg3_attempted": d_fg3a,
            "defensive_fg_made": d_fgm,
            "defensive_fg_attempted": d_fga,
            "defensive_ft_made": d_ftm,
            "defensive_ft_attempted": d_fta,
            "defensive_rebounds_offense": d_oreb,
            "defensive_rebounds_defense": d_dreb,
            "defensive_rebound_opportunities": dreb_opps,
            "defensive_assists": get_stat(d, "assists"),
            "defensive_steals": get_stat(d, "steals"),
            "defensive_turnovers": d_tov,
            "defensive_blocks": get_stat(d, "blocks"),
            "defensive_offensive_fouls": get_stat(d, "offensive_fouls"),
            "defensive_defensive_fouls": get_stat(d, "defensive_fouls"),
            "defensive_shooting_fouls": get_stat(d, "shooting_fouls"),
            "defensive_shot_attempt_points": get_stat(d, "shot_attempt_points"),
            "defensive_ft_potential_points": get_stat(d, "ft_potential_points"),
            "defensive_transition_take_fouls": get_stat(d, "transition_take_fouls"),
            "offensive_fg_pct": round(_safe_divide(o_fgm, o_fga), 4),
            "offensive_fg2_pct": round(_safe_divide(o_fg2m, o_fg2a), 4),
            "offensive_fg3_pct": round(_safe_divide(o_fg3m, o_fg3a), 4),
            "defensive_fg_pct": round(_safe_divide(d_fgm, d_fga), 4),
            "defensive_fg2_pct": round(_safe_divide(d_fg2m, d_fg2a), 4),
            "defensive_fg3_pct": round(_safe_divide(d_fg3m, d_fg3a), 4),
        }
        results.append(record)

    reverse_sort = True
    if sort_by.startswith("-"):
        sort_key = sort_by[1:]
    else:
        sort_key = sort_by

    results.sort(key=lambda r: r.get(sort_key, 0) or 0, reverse=reverse_sort)
    return results


def get_rumbles_counter_lineup() -> LineupRecord | None:
    five_man_lineups = get_lineup_league_summary_stats(lineup_size=5, min_possessions=1)
    if not five_man_lineups:
        return None

    def calculate_counter_score(lineup: LineupRecord) -> float:
        dreb_score = lineup.get("defensive_dreb_pct", 0.0) * 0.40
        oreb_score = lineup.get("offensive_oreb_pct", 0.0) * 0.25
        net_score = (lineup.get("net_rating", 0.0) / 2.0) * 0.20
        tov_score = lineup.get("defensive_tov_pct", 0.0) * 0.15
        return dreb_score + oreb_score + net_score + tov_score

    best_counter = max(five_man_lineups, key=calculate_counter_score)
    return best_counter
