// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package handler

import (
	"net/http"

	"digital-assets/backend/internal/logic"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"
	"github.com/zeromicro/go-zero/rest/httpx"
)

func CreateChatDirectHandler(svcCtx *svc.ServiceContext) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req types.ChatDirectRequest
		if err := httpx.Parse(r, &req); err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
			return
		}

		l := logic.NewCreateChatDirectLogic(r.Context(), svcCtx)
		resp, err := l.CreateChatDirect(&req)
		if err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
		} else {
			httpx.OkJsonCtx(r.Context(), w, resp)
		}
	}
}
