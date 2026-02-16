<?php

namespace Icinga\Module\Perfdatagraphs\Widget;

use Icinga\Application\Config;

use ipl\Html\BaseHtmlElement;
use ipl\Html\Html;
use ipl\Web\Url;
use ipl\I18n\Translation;
use ipl\Web\Widget\Icon;

/**
 * The QuickActions adds links for selecting the duration.
 */
class QuickActions extends BaseHtmlElement
{
    use Translation;

    protected const RANGE_MODE_URL_PARAM = 'perfdatagraphs.mode';
    protected const RANGE_MODE_DURATION = 'duration';
    protected const RANGE_MODE_CUSTOM = 'custom';
    protected const RANGE_FROM_URL_PARAM = 'perfdatagraphs.from';
    protected const RANGE_TO_URL_PARAM = 'perfdatagraphs.to';
    protected const GROUPED_VIEW_URL_PARAM = 'perfdatagraphs.grouped';

    protected $timeranges = [];

    protected $tag = 'ul';

    protected $defaultAttributes = ['class' => 'quick-actions'];

    // The URL parameter we append to the URL to specify the duration the backend should fetch
    protected $rangeURLParam = 'perfdatagraphs.duration';

    protected $baseURL;

    /**
     * @param Url $baseURL URL to use as base for the links. We get this from the request
     * so that we can support IcingaDB and the monitoring module.
     */
    public function __construct(Url $baseURL)
    {
        $this->baseURL = $baseURL;

        $this->timeranges = $this->getDefaultTimeranges();

        $configuredRanges = $this->getConfigTimeranges();

        if (count($configuredRanges) > 1) {
            $this->timeranges = $configuredRanges;
        }
    }

    protected function getDateInputValue(string $param): string
    {
        $value = $this->baseURL->getParam($param);

        return is_string($value) ? $value : '';
    }

    protected function isGroupedViewEnabled(): bool
    {
        $value = $this->baseURL->getParam(self::GROUPED_VIEW_URL_PARAM);

        if (! is_string($value) || $value === '') {
            return true;
        }

        return ! in_array(strtolower($value), ['0', 'false', 'off', 'no'], true);
    }

    /**
     * getConfigTimeranges returns the timeranges from the configuration
     */
    protected function getConfigTimeranges(): array
    {
        $tr = Config::module('perfdatagraphs', 'timeranges');
        $timeranges = [];

        foreach ($tr->keys() as $range) {
            $timeranges[$range] = [
                    'display_name' => $tr->get($range, 'display_name', $range),
                    'href_title' => $tr->get($range, 'href_title', ''),
                    'href_icon' => $tr->get($range, 'href_icon', 'calendar'),
            ];
        }

        return $timeranges;
    }

    /**
     * getDefaultTimeranges returns a default set of timeranges
     */
    protected function getDefaultTimeranges(): array
    {
        $defaultCurrentRange = 'PT12H';
        $config = Config::module('perfdatagraphs');

        if ($config !== null) {
                $defaultCurrentRange = $config->get('perfdatagraphs', 'default_timerange', 'PT12H');
        }

        return [
            $defaultCurrentRange => [
                "display_name" => $this->translate("Current"),
                "href_title" => $this->translate("Show performance data for the 12 hours"),
                "href_icon" => "calendar",
            ],
            'P1D' => [
                "display_name" => $this->translate("Day"),
                "href_title" => $this->translate("Show performance data for the last day"),
                "href_icon" => "calendar",
            ],
            'P7D' => [
                "display_name" => $this->translate("Week"),
                "href_title" => $this->translate("Show performance data for the last week"),
                "href_icon" => "calendar",
            ],
            'P30D' => [
                "display_name" => $this->translate("Month"),
                "href_title" => $this->translate("Show performance data for the last month"),
                "href_icon" => "calendar",
            ],
            'P1Y' => [
                "display_name" => $this->translate("Year"),
                "href_title" => $this->translate("Show performance data for the last year"),
                "href_icon" => "calendar",
            ],
        ];
    }

    /**
     * Implement the BaseHtmlElement assemble method.
     */
    protected function assemble(): void
    {
        foreach ($this->timeranges as $timerange => $details) {
            $elem = Html::tag(
                'a',
                [
                    'href' => $this->baseURL->overwriteParams([
                        self::RANGE_MODE_URL_PARAM => self::RANGE_MODE_DURATION,
                        $this->rangeURLParam => $timerange,
                    ])->getAbsoluteUrl(),
                    'class' => 'action-link',
                    'title' => $this->translate($details['href_title']),
                ],
                [ new Icon($details['href_icon'] ?? 'calendar'), $this->translate($details['display_name']) ]
            );

            $this->add(Html::tag('li', $elem));
        }

        $customRange = Html::tag('form', [
            'class' => 'quick-actions-custom-range',
            'method' => 'GET',
            'action' => $this->baseURL->getAbsoluteUrl(),
        ], [
            Html::tag('input', [
                'type' => 'hidden',
                'name' => self::RANGE_MODE_URL_PARAM,
                'value' => self::RANGE_MODE_CUSTOM,
            ]),
            Html::tag('label', ['class' => 'sr-only', 'for' => 'perfdatagraphs-from'], $this->translate('From')),
            Html::tag('input', [
                'id' => 'perfdatagraphs-from',
                'name' => self::RANGE_FROM_URL_PARAM,
                'type' => 'date',
                'value' => $this->getDateInputValue(self::RANGE_FROM_URL_PARAM),
                'required' => true,
                'title' => $this->translate('Start date'),
            ]),
            Html::tag('label', ['class' => 'sr-only', 'for' => 'perfdatagraphs-to'], $this->translate('To')),
            Html::tag('input', [
                'id' => 'perfdatagraphs-to',
                'name' => self::RANGE_TO_URL_PARAM,
                'type' => 'date',
                'value' => $this->getDateInputValue(self::RANGE_TO_URL_PARAM),
                'required' => true,
                'title' => $this->translate('End date'),
            ]),
            Html::tag('button', [
                'type' => 'submit',
                'class' => 'action-link',
                'title' => $this->translate('Show performance data for a custom date range'),
            ], [new Icon('calendar'), $this->translate('Range')]),
        ]);

        $this->add(Html::tag('li', $customRange));

        $this->add(Html::tag('li', [
            'class' => 'quick-actions-group-toggle',
        ], Html::tag('label', [
            'for' => 'perfdatagraphs-grouped-toggle',
        ], [
            Html::tag('input', [
                'type' => 'checkbox',
                'id' => 'perfdatagraphs-grouped-toggle',
                'class' => 'perfdatagraphs-grouped-toggle',
                'name' => self::GROUPED_VIEW_URL_PARAM,
                'value' => '1',
                'checked' => $this->isGroupedViewEnabled(),
            ]),
            $this->translate('Grouped'),
        ])));
    }
}
