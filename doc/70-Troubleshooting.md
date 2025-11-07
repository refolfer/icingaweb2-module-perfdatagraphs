# Troubleshooting

The module uses Icinga Web's logger. To have a more verbose debug logging,
follow the Icinga Web documentation an how to configure the logging. Example:

```
[logging]
log = "file"
level = "DEBUG"
file = "/usr/share/icingaweb2/log/icingaweb2.log"
```

To investigate the data processing and chart rendering in JavaScript
open your Browser's development console and set the Icinga Web Logger to `debug` level, to see the JavaScript logs:

```
icinga.logger.setLevel("debug")
```
