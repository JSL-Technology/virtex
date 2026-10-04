import { EnvironmentProviders, inject, provideEnvironmentInitializer } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LocaleStore } from '@virteex/shared/ui-i18n';

/**
 * Highcharts in the reader's language.
 *
 * Its accessibility module describes every chart to screen readers in English — «Chart with 7
 * data points», «Interactive chart», «Chart menu» — and its own month and number formatting
 * follows the browser, not the app (QA M-17). `lang` is a global option, so it is set once at
 * start and again on every language change, from the same catalogue as the rest of the screen.
 *
 * The chart-type sentences keep Highcharts' own templating (`{numPoints}`, `{#eq …}`) in the
 * catalogue: it is what lets a translation say «1 punto» and «7 puntos» correctly.
 */
const CHART_TYPES = {
  emptyChart: 'charts.types.empty_chart',
  defaultSingle: 'charts.types.default_single',
  defaultMultiple: 'charts.types.default_multiple',
  lineSingle: 'charts.types.line_single',
  lineMultiple: 'charts.types.line_multiple',
  splineSingle: 'charts.types.spline_single',
  splineMultiple: 'charts.types.spline_multiple',
  columnSingle: 'charts.types.column_single',
  columnMultiple: 'charts.types.column_multiple',
  barSingle: 'charts.types.bar_single',
  barMultiple: 'charts.types.bar_multiple',
  pieSingle: 'charts.types.pie_single',
  pieMultiple: 'charts.types.pie_multiple',
  areaSingle: 'charts.types.area_single',
  areaMultiple: 'charts.types.area_multiple',
  combinationChart: 'charts.types.combination_chart',
} as const;

export function chartLang(translate: TranslateService, locale: string): Record<string, unknown> {
  const t = (key: string): string => translate.instant(key);
  const chartTypes = Object.fromEntries(Object.entries(CHART_TYPES).map(([option, key]) => [option, t(key)]));
  return {
    locale,
    loading: t('charts.loading'),
    noData: t('charts.no_data'),
    resetZoom: t('charts.reset_zoom'),
    contextButtonTitle: t('charts.menu'),
    downloadPNG: t('charts.download_png'),
    downloadJPEG: t('charts.download_jpeg'),
    downloadPDF: t('charts.download_pdf'),
    downloadSVG: t('charts.download_svg'),
    printChart: t('charts.print'),
    viewFullscreen: t('charts.fullscreen'),
    exitFullscreen: t('charts.exit_fullscreen'),
    accessibility: {
      defaultChartTitle: t('charts.default_title'),
      chartContainerLabel: t('charts.container_label'),
      svgContainerLabel: t('charts.interactive_chart'),
      chartTypes,
      legend: { legendLabel: t('charts.legend_label'), legendItem: t('charts.legend_item') },
      exporting: { menuButtonLabel: t('charts.menu'), chartMenuLabel: t('charts.menu') },
      screenReaderSection: { beforeRegionLabel: '', afterRegionLabel: '', endOfChartMarker: t('charts.end_of_chart') },
    },
  };
}

async function apply(translate: TranslateService, locale: string): Promise<void> {
  const Highcharts = (await import('highcharts/esm/highcharts')).default;
  Highcharts.setOptions({ lang: chartLang(translate, locale) as never });
}

export function provideChartLanguage(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const translate = inject(TranslateService);
    const locale = inject(LocaleStore);
    const run = () => void apply(translate, locale.locale()).catch(() => undefined);
    translate.onLangChange.subscribe(run);
    translate.onTranslationChange.subscribe(run);
    if (translate.currentLang) run();
  });
}
