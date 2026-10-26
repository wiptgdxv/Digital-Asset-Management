// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package config

import "github.com/zeromicro/go-zero/rest"

type Config struct {
	rest.RestConf
	DatabaseURL            string
	UploadDir              string `json:",default=../uploads"`
	CookieSecure           bool   `json:",default=false"`
	AllowedOrigin          string `json:",default=http://127.0.0.1:5173"`
	BootstrapAdminUsername string `json:",optional"`
}
