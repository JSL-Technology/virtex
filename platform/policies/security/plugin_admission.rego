package virtex.security.plugins

default allow = false

# A plugin must be signed to be admitted.
allow {
    input.plugin.is_signed == true
    input.plugin.signature_valid == true
    not has_critical_vulnerabilities
    not violates_egress_policy
}

# Reject if the plugin's SBOM declares any CRITICAL vulnerability.
has_critical_vulnerabilities {
    input.plugin.sbom.vulnerabilities[_].severity == "CRITICAL"
}

# Egress policy: plugins may only connect to hosts on the allowlist.
violates_egress_policy {
    destination := input.plugin.requested_egress[_]
    not is_allowed_host(destination)
}

is_allowed_host(host) {
    allowed_hosts := {"api.dian.gov.co", "nfe.fazenda.sp.gov.br", "api.taxjar.com"}
    allowed_hosts[host]
}
