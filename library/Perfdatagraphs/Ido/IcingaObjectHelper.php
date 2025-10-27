<?php

namespace Icinga\Module\Perfdatagraphs\Ido;

use Icinga\Module\Monitoring\Backend\MonitoringBackend;
use Icinga\Module\Monitoring\Object\Host;
use Icinga\Module\Monitoring\Object\Macro;
use Icinga\Module\Monitoring\Object\MonitoredObject;
use Icinga\Module\Monitoring\Object\Service;

use Icinga\Exception\NotFoundError;

/**
 * IcingaObjectHelper is a helper class to work with Icinga objects.
 */
class IcingaObjectHelper
{
    // Name of all the custom variables we use.
    public const CUSTOM_VAR_CONFIG_PREFIX  = 'perfdatagraphs_config';
    public const CUSTOM_VAR_CONFIG_INCLUDE = 'perfdatagraphs_config_metrics_include';
    public const CUSTOM_VAR_CONFIG_EXCLUDE = 'perfdatagraphs_config_metrics_exclude';
    public const CUSTOM_VAR_CONFIG_HIGHLIGHT = 'perfdatagraphs_config_highlight';
    public const CUSTOM_VAR_CONFIG_DISABLE = 'perfdatagraphs_config_disable';
    public const CUSTOM_VAR_CONFIG_BACKEND = 'perfdatagraphs_config_backend';
    public const CUSTOM_VAR_METRICS = 'perfdatagraphs_metrics';

    /**
     * getObjectFromString returns a Host or Service object from the database given the strings.
     *
     * @param string $host host name for the object
     * @param string $service service name for the object
     * @param bool $isHostCheck Is this a Host check
     * @return ?MonitoredObject
     */
    public function getObjectFromString(string $host, string $service, bool $isHostCheck): ?MonitoredObject
    {
        // Determine the type if Model we need to use to get the data.
        try {
            if ($isHostCheck) {
                $object = new Host(MonitoringBackend::instance(), $host);
            } else {
                $object = new Service(MonitoringBackend::instance(), $host, $service);
            }
        } catch (NotFoundError $e) {
            // Maybe there's a better way but OK for now.
            return null;
        }

        $object->fetch();

        return $object;
    }

    /**
     * getPerfdataGraphsConfigForObject returns the this module's config custom variables for an object.
     *
     * @param MonitoredObject $object Icinga Object
     * @return array
     */
    public function getPerfdataGraphsConfigForObject(MonitoredObject $object): array
    {
        $data = [];

        if (empty($object)) {
            return $data;
        }

        // Get the object's custom variables and decode them
        $result = [];

        $c = $object->customvars;
        if (empty($c)) {
            return $result;
        }

        foreach ($c as $key => $value) {
            // We are only interested in our custom vars
            if (str_starts_with($key, self::CUSTOM_VAR_CONFIG_PREFIX)) {
                $result[$key] = $value;
            }
        }

        return $result;
    }

    /**
     * getPerfdataGraphsConfigForObject returns the this module's metrics custom variables for an object.
     *
     * @param MonitoredObject $object Icinga Object
     * @return array
     */
    public function getPerfdataGraphsMetricsForObject(MonitoredObject $object): array
    {
        $data = [];

        if (empty($object)) {
            return $data;
        }

        $result = [];

        $c = $object->customvars;
        if (empty($c)) {
            return $result;
        }

        // Get the object's custom variables and decode them
        foreach ($c as $key => $value) {
            // We are only interested in our custom vars
            if (str_starts_with($key, self::CUSTOM_VAR_METRICS)) {
                // Since these custom vars are dictionaries, we parse them into an array of arrays
                $result[$key] = $this->objectToArray($value);
            }
        }

        return $result[self::CUSTOM_VAR_METRICS] ?? [];
    }

    /**
     * Transform stdClass into array recursively
     */
    protected function objectToArray($data)
    {
        if (is_object($data)) {
            $data = get_object_vars($data);
        }

        if (is_array($data)) {
            return array_map([$this, 'objectToArray'], $data);
        }

        return $data;
    }

    /**
     * expandMacros returns the given string with macros being resolved.
     * This can be used in backend modules when object information are required,
     * e.g. Graphite templates.
     */
    public function expandMacros(string $input, $object): string
    {
        return Macro::resolveMacros($input, $object);
    }
}
