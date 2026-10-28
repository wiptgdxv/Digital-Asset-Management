// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package handler

import (
	"net/http"

	"digital-assets/backend/internal/logic"
	"digital-assets/backend/internal/svc"
	"github.com/zeromicro/go-zero/rest/httpx"
)

func ListChatConversationsHandler(svcCtx *svc.ServiceContext) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		l := logic.NewListChatConversationsLogic(r.Context(), svcCtx)
		resp, err := l.ListChatConversations()
		if err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
		} else {
			httpx.OkJsonCtx(r.Context(), w, resp)
		}
	}
}
