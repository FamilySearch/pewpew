# Tuning a machine for a load test

## Tuning a Linux machine
To get maximum throughput on Linux consider the following tweaks. *NOTE*: These tweaks have been tested in Ubuntu 18.04 and may be different in other distributions.

Append the following to `/etc/sysctl.conf`:

```
fs.file-max = 999999
net.ipv4.tcp_rmem = 4096 4096 16777216
net.ipv4.tcp_wmem = 4096 4096 16777216
net.ipv4.ip_local_port_range = 1024 65535
```

Append the following to `/etc/security/limits.conf`:
```
*               -       nofile         999999
```

## Tuning a Windows machine
Using the registry editor, navigate to the following path:

`HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\`

Add (or edit if it exists) the entry `MaxUserPort` as a `DWORD` type and set the value as `65534` (decimal).

Alternatively, save the following as `port.reg` and run the file:

```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters]
"MaxUserPort"=dword:0000fffe
```