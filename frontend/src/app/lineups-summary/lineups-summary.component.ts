import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LineupsService, LineupSummaryRecord } from '../_services/lineups.service';

export interface MetricDefinition {
  code: string;
  name: string;
  category: 'Efficiency' | 'Four Factors' | 'Shooting & Spacing';
  formula: string;
  explanation: string;
  coachingContext: string;
}

@Component({
  selector: 'lineups-summary-component',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lineups-summary.component.html',
  styleUrl: './lineups-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineupsSummaryComponent implements OnInit {
  private readonly lineupsService = inject(LineupsService);
  private readonly cdr = inject(ChangeDetectorRef);

  // Keep both the raw aggregate set and the filtered view so sorting, searching,
  // and pagination remain fast without refetching the backend on every change.
  lineups: LineupSummaryRecord[] = [];
  filteredLineups: LineupSummaryRecord[] = [];
  isLoading = false;
  errorMessage = '';

  rumbleCounterLineup: LineupSummaryRecord | null = null;
  showGlossary = false;
  glossaryActiveCategory: string = 'All';

  lineupSize = 5;
  minPossessions = 0;
  selectedTeam = '';
  searchQuery = '';
  activeMetricTab: 'core' | 'four_factors' | 'shooting' = 'core';

  sortColumn: keyof LineupSummaryRecord = 'total_possessions';
  sortAsc = false;

  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [10, 25, 50];

  readonly teams = [
    { id: '', name: 'All Teams' },
    { id: '11c7d162-14cb-5371-aeac-0c06dcdd6418', name: 'Tune Squad' },
    { id: '3c700625-848c-5afd-88c1-5cb60b0d5834', name: 'Justice League' },
    { id: '36e29cdb-520a-58bb-9608-6bf9522decb6', name: 'The Avengers' },
  ];

  readonly metricsGlossary: MetricDefinition[] = [
    {
      code: 'ORtg',
      name: 'Offensive Rating',
      category: 'Efficiency',
      formula: '(Points Scored / Offensive Possessions) * 100',
      explanation: 'Estimates points produced per 100 offensive possessions.',
      coachingContext: 'Neutralizes pace differences to reveal true scoring potency.'
    },
    {
      code: 'DRtg',
      name: 'Defensive Rating',
      category: 'Efficiency',
      formula: '(Points Allowed / Defensive Possessions) * 100',
      explanation: 'Estimates points conceded per 100 defensive possessions.',
      coachingContext: 'Lower indicates a stingier defensive unit.'
    },
    {
      code: 'NetRtg',
      name: 'Net Rating Differential',
      category: 'Efficiency',
      formula: 'ORtg - DRtg',
      explanation: 'Point differential per 100 possessions.',
      coachingContext: 'The definitive indicator of aggregate lineup dominance.'
    },
    {
      code: 'eFG%',
      name: 'Effective Field Goal %',
      category: 'Four Factors',
      formula: '(FGM + 0.5 * 3PM) / FGA',
      explanation: 'Adjusts shooting accuracy by weighting 3-pointers at 1.5x.',
      coachingContext: 'Dean Oliver Factor #1: Quantifies true live-ball shooting efficiency.'
    },
    {
      code: 'TOV%',
      name: 'Turnover Rate',
      category: 'Four Factors',
      formula: '(Turnovers / Possessions) * 100',
      explanation: 'Percentage of possessions terminating in a turnover.',
      coachingContext: 'Dean Oliver Factor #2: Valuing ball security and transition prevention.'
    },
    {
      code: 'OREB% / DREB%',
      name: 'Rebound Rates',
      category: 'Four Factors',
      formula: 'Rebounds Grabbed / Rebound Opportunities',
      explanation: 'Share of available missed shots secured on either end.',
      coachingContext: 'Dean Oliver Factor #3: Critical counter-metric against jumbo frontcourts.'
    },
    {
      code: 'FTR',
      name: 'Free Throw Rate',
      category: 'Four Factors',
      formula: 'FTA / FGA',
      explanation: 'Ratio of free throw attempts generated per field goal shot.',
      coachingContext: 'Dean Oliver Factor #4: Measures paint pressure and whistle generation.'
    },
    {
      code: 'TS%',
      name: 'True Shooting %',
      category: 'Shooting & Spacing',
      formula: 'Points / (2 * (FGA + 0.44 * FTA))',
      explanation: 'Comprehensive scoring efficiency accounting for 2s, 3s, and FTs.',
      coachingContext: 'The premier holistic benchmark for scoring productivity.'
    },
    {
      code: '3PAr',
      name: '3-Point Attempt Rate',
      category: 'Shooting & Spacing',
      formula: '3PA / FGA',
      explanation: 'Proportion of total field goals taken from beyond the arc.',
      coachingContext: 'Evaluates perimeter spacing and floor gravity.'
    }
  ];

  ngOnInit(): void {
    this.fetchLineups();
    this.fetchRumbleCounter();
  }

  fetchLineups(): void {
    // Request the current lineup slice using the active filter state so the UI
    // stays aligned with the backend's aggregate dataset.
    this.isLoading = true;
    this.errorMessage = '';

    this.lineupsService
      .getLineupsLeagueSummary({
        lineup_size: this.lineupSize,
        min_possessions: this.minPossessions,
        team_id: this.selectedTeam,
      })
      .subscribe({
        next: (res) => {
          this.lineups = res.apiResponse || [];
          this.applyFiltersAndSort();
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = err?.errorMessages?.[0] || 'Failed to retrieve lineup data.';
          this.cdr.markForCheck();
        },
      });
  }

  fetchRumbleCounter(): void {
    this.lineupsService.getRumblesCounterLineup().subscribe({
      next: (data) => {
        this.rumbleCounterLineup = data;
        this.cdr.markForCheck();
      },
      error: () => {
        this.rumbleCounterLineup = this.topReboundLineup;
        this.cdr.markForCheck();
      },
    });
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.fetchLineups();
  }

  onSearchChange(): void {
    this.currentPage = 1;
    this.applyFiltersAndSort();
  }

  applyFiltersAndSort(): void {
    // Search and sort operate on the source aggregate list, preserving the full
    // dataset for the KPI cards and other derived views.
    let result = [...this.lineups];

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      result = result.filter((row) =>
        row.players.some((p) => p.name.toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      const valA = (a[this.sortColumn] as number) ?? 0;
      const valB = (b[this.sortColumn] as number) ?? 0;
      return this.sortAsc ? valA - valB : valB - valA;
    });

    this.filteredLineups = result;
    this.cdr.markForCheck();
  }

  setSort(col: keyof LineupSummaryRecord): void {
    if (this.sortColumn === col) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = col;
      this.sortAsc = false;
    }
    this.applyFiltersAndSort();
  }

  get totalPages(): number {
    const size = Number(this.pageSize) || 10;
    return Math.max(1, Math.ceil(this.filteredLineups.length / size));
  }

  get paginatedLineups(): LineupSummaryRecord[] {
    const size = Number(this.pageSize) || 10;
    const startIndex = (this.currentPage - 1) * size;
    return this.filteredLineups.slice(startIndex, startIndex + size);
  }

  get visiblePageNumbers(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages: number[] = [];
    const maxVisible = 5;

    let start = Math.max(1, current - Math.floor(maxVisible / 2));
    let end = Math.min(total, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.cdr.markForCheck();
    }
  }

  onPageSizeChange(newSize?: number | Event): void {
    if (newSize instanceof Event) {
      const target = newSize.target as HTMLSelectElement;
      this.pageSize = Number(target.value);
    } else if (newSize !== undefined) {
      this.pageSize = Number(newSize);
    } else {
      this.pageSize = Number(this.pageSize);
    }
    this.currentPage = 1;
    this.cdr.markForCheck();
  }

  get startIndex(): number {
    if (this.filteredLineups.length === 0) return 0;
    const size = Number(this.pageSize) || 10;
    return (this.currentPage - 1) * size + 1;
  }

  get endIndex(): number {
    const size = Number(this.pageSize) || 10;
    return Math.min(this.currentPage * size, this.filteredLineups.length);
  }

  exportToCSV(): void {
    // Export the currently visible scouting slice so staff can share the filtered
    // lineup view outside the app without losing the active context.
    if (!this.filteredLineups.length) return;

    const headers = ['Team', 'Personnel', 'Possessions', 'ORtg', 'DRtg', 'NetRtg', 'eFG%', 'DREB%', 'TS%'];
    const rows = this.filteredLineups.map((r) => [
      `"${r.team_name || ''}"`,
      `"${r.players.map((p) => p.name).join(', ')}"`,
      r.total_possessions,
      Number(r.offensive_rating ?? 0).toFixed(1),
      Number(r.defensive_rating ?? 0).toFixed(1),
      Number(r.net_rating ?? 0).toFixed(1),
      (Number(r.offensive_efg_pct ?? 0) * 100).toFixed(1) + '%',
      Number(r.defensive_dreb_pct ?? 0).toFixed(1) + '%',
      (Number(r.offensive_ts_pct ?? 0) * 100).toFixed(1) + '%'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `okc_thunder_lineup_scout_${this.lineupSize}man.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  openGlossary(): void {
    this.showGlossary = true;
    this.cdr.markForCheck();
  }

  closeGlossary(): void {
    this.showGlossary = false;
    this.cdr.markForCheck();
  }

  get displayedGlossaryMetrics(): MetricDefinition[] {
    if (this.glossaryActiveCategory === 'All') {
      return this.metricsGlossary;
    }
    return this.metricsGlossary.filter(m => m.category === this.glossaryActiveCategory);
  }

  get topNetRatingLineup(): LineupSummaryRecord | null {
    if (!this.lineups.length) return null;
    return [...this.lineups].sort((a, b) => b.net_rating - a.net_rating)[0];
  }

  get topOffensiveLineup(): LineupSummaryRecord | null {
    if (!this.lineups.length) return null;
    return [...this.lineups].sort((a, b) => b.offensive_rating - a.offensive_rating)[0];
  }

  get topReboundLineup(): LineupSummaryRecord | null {
    if (!this.lineups.length) return null;
    return [...this.lineups].sort((a, b) => b.defensive_dreb_pct - a.defensive_dreb_pct)[0];
  }
}