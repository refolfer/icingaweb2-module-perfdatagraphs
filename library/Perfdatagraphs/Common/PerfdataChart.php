<?php

namespace Icinga\Module\Perfdatagraphs\Common;

use Icinga\Module\Perfdatagraphs\Widget\QuickActions;

use Icinga\Application\Benchmark;
use Icinga\Application\Logger;
use Icinga\Util\Json;

use ipl\Html\Html;
use ipl\Html\HtmlElement;
use ipl\Html\ValidHtml;
use ipl\I18n\Translation;
use ipl\Web\Url;
use ipl\Web\Widget\Icon;
use DateTimeImmutable;
use Throwable;

/**
 * PerfdataChart contains common functionality used for rendering the performance data charts.
 * The idea is that you use this in the hook to create the chart elements.
 */
trait PerfdataChart
{
    use Translation;

    private const RANGE_MODE_URL_PARAM = 'perfdatagraphs.mode';
    private const RANGE_MODE_CUSTOM = 'custom';
    private const RANGE_DURATION_URL_PARAM = 'perfdatagraphs.duration';
    private const RANGE_FROM_URL_PARAM = 'perfdatagraphs.from';
    private const RANGE_TO_URL_PARAM = 'perfdatagraphs.to';

    /**
     * generateID generate a unique and safe ID for each chart.
     * @param string $hostName Name of the host
     * @param string $serviceName Name of the service
     * @param string $checkcommandName Name of the checkcommand
     * @return string A valid HTML ID
     */
    private function generateID(string $hostName, string $serviceName, string $checkCommandName): string
    {
        // Since there might be whatever in the names.
        return rtrim(base64_encode(sprintf('%s-%s-%s', $hostName, $serviceName, $checkCommandName)), '=');
    }

    private function parseDateParam(?string $value, int $hour, int $minute, int $second): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        } catch (Throwable $e) {
            return null;
        }

        if ($date === false) {
            return null;
        }

        return $date->setTime($hour, $minute, $second)->getTimestamp();
    }

    private function durationForTimestamp(int $from): string
    {
        $seconds = max(1, time() - $from);
        $days = max(1, (int) ceil($seconds / 86400));

        return sprintf('P%dD', $days);
    }

    private function resolveTimeRange(array $config): array
    {
        $requestUrl = Url::fromRequest();
        $duration = $config['default_timerange'];
        $rangeFrom = null;
        $rangeTo = null;

        if ($requestUrl->hasParam(self::RANGE_DURATION_URL_PARAM)) {
            $duration = $requestUrl->getParam(self::RANGE_DURATION_URL_PARAM);
        }

        if (($requestUrl->getParam(self::RANGE_MODE_URL_PARAM) ?? '') !== self::RANGE_MODE_CUSTOM) {
            return [
                'duration' => $duration,
                'rangeFrom' => $rangeFrom,
                'rangeTo' => $rangeTo,
            ];
        }

        $rangeFrom = $this->parseDateParam($requestUrl->getParam(self::RANGE_FROM_URL_PARAM), 0, 0, 0);
        $rangeTo = $this->parseDateParam($requestUrl->getParam(self::RANGE_TO_URL_PARAM), 23, 59, 59);

        if ($rangeFrom === null || $rangeTo === null || $rangeFrom > $rangeTo) {
            Logger::warning('Invalid custom timerange requested, falling back to duration');
            return [
                'duration' => $duration,
                'rangeFrom' => null,
                'rangeTo' => null,
            ];
        }

        // Keep compatibility with backends that still use only duration.
        $duration = $this->durationForTimestamp($rangeFrom);

        return [
            'duration' => $duration,
            'rangeFrom' => $rangeFrom,
            'rangeTo' => $rangeTo,
        ];
    }

    /**
     * createChart creates HTMLElements that are used to render charts in.
     *
     * @param string $hostName Name of the host
     * @param string $serviceName Name of the service
     * @param string $checkcommandName Name of the checkcommand
     * @param bool $isHostCheck Is this a Host check
     *
     * @return ValidHtml
     */
    public function createChart(string $hostName, string $serviceName, string $checkCommandName, bool $isHostCheck): ValidHtml
    {
        // Generic container for all elements we want to create here.
        $main = HtmlElement::create('div', ['class' => 'perfdata-charts']);

        // Ok so hear me out, since we are using a <canvas> to render the charts
        // we cannot use CSS classes to style the content of the chart.
        // However, we can use jQuery's .css() method to get CSS values from HTML elements,
        // which means we can create some non-visible elements with the style we want and
        // then fetch this data via JavaScript. Stupid? Maybe. Does it work? Yes.
        $colorClasses = ['axes-color', 'value-color', 'warning-color', 'critical-color'];
        foreach ($colorClasses as $class) {
            $d = HtmlElement::create('div', [
                'class' => $class,
            ]);
            $main->add($d);
        }

        // How we identify our elements in JS.
        $elemID = $this->generateID($hostName, $serviceName, $checkCommandName);

        // Where we store all elements for the charts.
        $charts = HtmlElement::create('div', [
            'class' => 'perfdata-charts-container collapsible',
            'id' => $elemID,
            // Note: We could have a configuration option to change the
            // "always collapsed" behaviour
            'data-visible-height' => 0,
            'data-toggle-element' => '.perfdata-charts-container-control',
        ]);

        // We create our own collapsible control because we might
        // want to identify it in the JS
        $chartsControl = HtmlElement::create('div', [
            'class' => 'perfdata-charts-container-control',
            'id' => $elemID . '-control',
        ]);

        $toggleButton = new HtmlElement(
            'button',
            null,
            new Icon('angle-double-up', ['class' => 'collapse-icon']),
            new Icon('angle-double-down', ['class' => 'expand-icon'])
        );

        // Add a headline and all other elements to our element.
        $header = Html::tag('h2', $this->translate('Performance Data Graph'));

        $main->add($header);

        // Load the module's configuration.
        $config = ModuleConfig::getConfigWithDefaults();

        $timerange = $this->resolveTimeRange($config);
        $duration = $timerange['duration'];
        $rangeFrom = $timerange['rangeFrom'];
        $rangeTo = $timerange['rangeTo'];

        $source = new PerfdataSource($config);

        $cacheDurationInSeconds = $config['cache_lifetime'];
        $h = $isHostCheck ? 'true': 'false';
        // base64 since there can be whatever in the names
        $cacheKey = base64_encode($hostName . $serviceName . $checkCommandName . $duration . $rangeFrom . $rangeTo . $h);

        Benchmark::measure('Rendering performance data elements');

        // Get data from cache if it is available
        $datasets = $source->getDataFromCache($cacheKey, $cacheDurationInSeconds);

        $main->add((new QuickActions(Url::fromRequest())));

        // If not, fetch the perfdata for a given object via the hook.
        if (!$datasets) {
            $perfdata = $source->fetchDataViaHook(
                $hostName,
                $serviceName,
                $checkCommandName,
                $duration,
                $isHostCheck,
                $rangeFrom,
                $rangeTo
            );
            $msg = null;

            // Error handling, if this gets too long, we could move this to a method.
            if ($perfdata->hasErrors()) {
                $msg = sprintf($this->translate('Error while fetching data: %s'), join(' ', $perfdata->getErrors()));
                Logger::debug('Error while fetching data: %s', Json::sanitize($perfdata));
            }

            if ($perfdata->isEmpty()) {
                $msg = $msg . ' ' . $this->translate('No data received.');
            }

            if (!$perfdata->isValid()) {
                $msg = $msg . ' ' . sprintf($this->translate('Invalid data received: %s'), join(' ', $perfdata->getErrors()));
                Logger::debug('Invalid data received: %s', Json::sanitize($perfdata));
            }

            if (isset($msg)) {
                $main->add(HtmlElement::create('p', ['class' => 'line-chart-error preformatted'], $msg));
                return $main;
            }

            foreach ($perfdata->getDatasets() as $dataset) {
                $datasets[$dataset->getTitle()] = Json::sanitize($dataset);
            }

            // After transforming the data store it. We're just storing the acutal datasets
            // since the rest is just relevant for the request.
            $source->storeDataToCache($cacheKey, $datasets);
        }

        // Elements in which the charts will get rendered.
        // We use attributes on this elements to transport data
        // to the JavaScript part of this module.
        foreach ($datasets as $title => $data) {
            $chart = HtmlElement::create('div', [
                // We use a perfdatagraphs prefix here to avoid overlap with other modules (i.e. Icinga Kubernetes)
                'class' => 'perfdatagraphs-line-chart',
                'id' => $elemID . '_' . $title,
                'data-perfdata' => $data,
                'data-range-from' => $rangeFrom,
                'data-range-to' => $rangeTo,
            ]);

            $charts->add($chart);
        }

        $main->add($charts);

        Benchmark::measure('Rendered performance data elements');

        // We only need the toggle button when there are more charts
        if (count($datasets) > 1) {
            $chartsControl->add($toggleButton);
        }

        $main->add($chartsControl);

        return $main;
    }
}
