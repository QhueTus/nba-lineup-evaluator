import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { BaseService } from './base.service';

export interface PlayerInfo {
  player_id: string;
  name: string;
}

export interface LineupSummaryRecord {
  team_id: string;
  team_name: string;
  player_ids: string[];
  players: PlayerInfo[];
  total_possessions: number;
  offensive_possessions: number;
  defensive_possessions: number;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  offensive_efg_pct: number;
  defensive_efg_pct: number;
  offensive_tov_pct: number;
  defensive_tov_pct: number;
  offensive_oreb_pct: number;
  defensive_dreb_pct: number;
  offensive_ft_rate: number;
  defensive_ft_rate: number;
  offensive_ts_pct: number;
  offensive_3par: number;
  offensive_points: number;
  defensive_points: number;
  offensive_fg_pct: number;
  offensive_fg2_pct: number;
  offensive_fg3_pct: number;
  defensive_fg_pct: number;
  defensive_fg2_pct: number;
  defensive_fg3_pct: number;
}

export interface LineupQueryParams {
  lineup_size?: number;
  min_possessions?: number;
  team_id?: string;
  sort_by?: string;
}

export interface LineupApiResponse {
  endpoint: string;
  apiResponse: LineupSummaryRecord[];
}

@Injectable({ providedIn: 'root' })
export class LineupsService extends BaseService {
  constructor(protected override http: HttpClient) {
    super(http);
  }

  private buildQueryParams(queryParams: Record<string, string | number>): HttpParams {
    return Object.entries(queryParams).reduce(
      (params, [key, value]) => params.set(key, String(value)),
      new HttpParams(),
    );
  }

  private buildDisplayedEndpointWithParams(
    endpoint: string,
    queryParams: Record<string, string | number>,
  ): string {
    const queryString = new URLSearchParams(
      Object.entries(queryParams).map(([key, value]) => [key, String(value)]),
    ).toString();
    return queryString ? `${endpoint}?${queryString}` : endpoint;
  }

  getLineupsLeagueSummary(
    optionsOrSize: number | LineupQueryParams = 5,
  ): Observable<LineupApiResponse> {
    const endpoint = `${this.baseUrl}/lineups`;

    const options: LineupQueryParams =
      typeof optionsOrSize === 'number'
        ? { lineup_size: optionsOrSize }
        : optionsOrSize;

    const queryParams: Record<string, string | number> = {
      lineup_size: options.lineup_size ?? 5,
      min_possessions: options.min_possessions ?? 0,
      sort_by: options.sort_by ?? 'total_possessions',
    };

    if (options.team_id) {
      queryParams['team_id'] = options.team_id;
    }

    const params = this.buildQueryParams(queryParams);
    const displayedEndpointWithParams = this.buildDisplayedEndpointWithParams(
      endpoint,
      queryParams,
    );

    return this.get(endpoint, params).pipe(
      map((data) => ({
        endpoint: displayedEndpointWithParams,
        apiResponse: (data as LineupSummaryRecord[]) || [],
      })),
    );
  }
  
  getRumblesCounterLineup(): Observable<LineupSummaryRecord | null> {
  const endpoint = `${this.baseUrl}/lineups/rumble-counter`;
  return this.get(endpoint).pipe(
    map((data) => (data as LineupSummaryRecord) || null)
  );
}
}
