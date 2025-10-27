<?php

namespace Icinga\Module\Perfdatagraphs\ProvidedHook\Monitoring;

use Icinga\Module\Perfdatagraphs\Common\PerfdataChart;
use Icinga\Module\Perfdatagraphs\Ido\IcingaObjectHelper;

use Icinga\Module\Monitoring\Object\Host;
use Icinga\Module\Monitoring\Object\MonitoredObject;
use Icinga\Module\Monitoring\Object\Service;
use Icinga\Module\Monitoring\Hook\DetailviewExtensionHook;

use ipl\Html\HtmlString;

class DetailviewExtension extends DetailviewExtensionHook
{
    use PerfdataChart;

    public function getHtmlForObject(MonitoredObject $object)
    {
        $isHostCheck = false;

        if ($object instanceof Host) {
            $serviceName = $object->host_check_command;
            $hostName = $object->getName();
            $checkCommandName = $object->host_check_command;
            $isHostCheck = true;
        } elseif ($object instanceof Service) {
            $serviceName = $object->getName();
            $hostName = $object->getHost()->getName();
            $checkCommandName = $object->check_command;
        } else {
            // Unecessary but just to be safe.
            return HtmlString::create('');
        }

        $cvh = new IcingaObjectHelper();
        $customvars = $cvh->getPerfdataGraphsConfigForObject($object);

        // Check if charts are disabled for this object, if so we just return.
        if ($customvars[$cvh::CUSTOM_VAR_CONFIG_DISABLE] ?? false) {
            return HtmlString::create('');
        }

        // Get the configured element for the host.
        $chart = $this->createChart($hostName, $serviceName, $checkCommandName, $isHostCheck);

        if (empty($chart)) {
            // Probably unecessary but just to be safe.
            return HtmlString::create('');
        }

        return HtmlString::create($chart);
    }
}
