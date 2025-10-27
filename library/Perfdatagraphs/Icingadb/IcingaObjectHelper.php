<?php

namespace Icinga\Module\Perfdatagraphs\Icingadb;

use Icinga\Exception\NotFoundError;

use Icinga\Module\Icingadb\Common\Auth;
use Icinga\Module\Icingadb\Common\Database;
use Icinga\Module\Icingadb\Common\Macros;
use Icinga\Module\Icingadb\Model\Host;
use Icinga\Module\Icingadb\Model\Service;

use ipl\Stdlib\Filter;

use ipl\Orm\Model;

/**
 * IcingaObjectHelper is a helper class to work with Icinga objects.
 */
class IcingaObjectHelper
{
    use Database;
    use Auth;
    use Macros;

    // Name of all the custom variables we use.
    public const CUSTOM_VAR_CONFIG_PREFIX  = 'perfdatagraphs_config';
    public const CUSTOM_VAR_CONFIG_INCLUDE = 'perfdatagraphs_config_metrics_include';
    public const CUSTOM_VAR_CONFIG_EXCLUDE = 'perfdatagraphs_config_metrics_exclude';
    public const CUSTOM_VAR_CONFIG_HIGHLIGHT = 'perfdatagraphs_config_highlight';
    public const CUSTOM_VAR_CONFIG_DISABLE = 'perfdatagraphs_config_disable';
    public const CUSTOM_VAR_CONFIG_BACKEND = 'perfdatagraphs_config_backend';
    public const CUSTOM_VAR_METRICS = 'perfdatagraphs_metrics';

    /**
     * Returns the Host object from the database given the hostname.
     *
     * @param string $host host name for the object
     * @throws NotFoundError
     * @return Host
     */
    protected function getHostObject(string $host): Host
    {
        $query = Host::on($this->getDb())->with(['state']);

        $query->filter(Filter::equal('name', $host));

        $this->applyRestrictions($query);

        $host = $query->first();

        if ($host === null) {
            throw new NotFoundError(t('Host not found'));
        }

        return $host;
    }

    /**
     * Returns the Service object from the database given the hostname/servicename
     *
     * @param string $host host name for the object
     * @param string $service service name for the object
     * @throws NotFoundError
     * @return Service
     */
    protected function getServiceObject(string $host, string $service): Service
    {
        $query = Service::on($this->getDb())->with(['state', 'host']);

        $query->filter(Filter::equal('name', $service));
        $query->filter(Filter::equal('host.name', $host));

        $this->applyRestrictions($query);

        $service = $query->first();

        if ($service === null) {
            throw new NotFoundError(t('Service not found'));
        }

        return $service;
    }

    /**
     * getObjectFromString returns a Host or Service object from the database given the strings.
     *
     * @param string $host host name for the object
     * @param string $service service name for the object
     * @param bool $isHostCheck Is this a Host check
     * @return Model
     */
    public function getObjectFromString(string $host, string $service, bool $isHostCheck): ?Model
    {
        // Determine the type if Model we need to use to get the data.
        try {
            if ($isHostCheck) {
                $object = $this->getHostObject($host);
            } else {
                $object = $this->getServiceObject($host, $service);
            }
        } catch (NotFoundError $e) {
            // Maybe there's a better way but OK for now.
            return null;
        }

        return $object;
    }

    /**
     * getPerfdataGraphsConfigForObject returns the this module's config custom variables for an object.
     *
     * @param Model $object Icinga Object
     * @return array
     */
    public function getPerfdataGraphsConfigForObject(Model $object): array
    {
        $data = [];

        if (empty($object)) {
            return $data;
        }

        // Get the object's custom variables and decode them
        $customvars = $object->customvar->columns(['name', 'value']);

        $result = [];
        foreach ($customvars as $row) {
            // We are only interested in our custom vars
            if (str_starts_with($row->name, self::CUSTOM_VAR_CONFIG_PREFIX)) {
                $result[$row->name] = json_decode($row->value, true) ?? $row->value;
            }
        }

        return $result;
    }

    /**
     * getPerfdataGraphsConfigForObject returns the this module's metrics custom variables for an object.
     *
     * @param Model $object Icinga Object
     * @return array
     */
    public function getPerfdataGraphsMetricsForObject(Model $object): array
    {
        $data = [];

        if (empty($object)) {
            return $data;
        }

        // Get the object's custom variables and decode them
        $customvars = $object->customvar->columns(['name', 'value']);

        $result = [];
        foreach ($customvars as $row) {
            // We are only interested in our custom vars
            if ($row->name === self::CUSTOM_VAR_METRICS) {
                $result[$row->name] = json_decode($row->value, true) ?? $row->value;
            }
        }

        return $result[self::CUSTOM_VAR_METRICS] ?? [];
    }
}
